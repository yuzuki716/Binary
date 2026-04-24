"""
Real-time signal monitor.
Runs every 60 seconds. For each strategy with consEv > 0 (using user-entered payout rates),
fetches fresh OHLCV data, checks the last completed bar for signals, and sends Discord alerts.
Duplicate detection is handled by the SignalAlert table (symbol + timeframe + strategy + bar_ts).
"""
import asyncio
import logging
import math
from concurrent.futures import ThreadPoolExecutor

import httpx

logger = logging.getLogger(__name__)

MONITOR_INTERVAL = 60  # seconds

_REFERENCE_PAYOUT = 0.80
_Z = 0.674
_MIN_TRADES = 20
_TF_JP = {"1m": "1分足", "5m": "5分足", "15m": "15分足", "1h": "1時間足"}

_executor = ThreadPoolExecutor(max_workers=2)
_monitor_task: asyncio.Task | None = None


def _fixed_discount(win_rate: float, total_trades: int) -> float | None:
    if total_trades < _MIN_TRADES:
        return None
    se = math.sqrt(win_rate * (1 - win_rate) / total_trades)
    p_stat = win_rate - _Z * se
    decay = 0.90 if total_trades >= 100 else 0.85 if total_trades >= 50 else 0.80
    p_cons = 0.5 + (p_stat - 0.5) * decay
    ev_raw = win_rate * _REFERENCE_PAYOUT - (1 - win_rate)
    ev_cons = p_cons * _REFERENCE_PAYOUT - (1 - p_cons)
    return max(0.0, ev_raw - ev_cons)


async def start_monitor() -> None:
    global _monitor_task
    if _monitor_task and not _monitor_task.done():
        return
    _monitor_task = asyncio.create_task(_monitor_loop())
    logger.info("Signal monitor started (interval=%ds)", MONITOR_INTERVAL)


async def _monitor_loop() -> None:
    check_count = 0
    while True:
        try:
            await _check_signals()
            check_count += 1
            # Clean up old alerts once a day (~1440 checks)
            if check_count % 1440 == 0:
                await _cleanup_old_alerts()
        except Exception:
            logger.exception("Signal monitor check failed")
        await asyncio.sleep(MONITOR_INTERVAL)


async def _cleanup_old_alerts() -> None:
    from app.core.database import AsyncSessionLocal
    from app.models.orm import SignalAlert
    from sqlalchemy import delete
    from datetime import datetime, timezone, timedelta

    cutoff = datetime.now(timezone.utc) - timedelta(days=7)
    async with AsyncSessionLocal() as db:
        await db.execute(delete(SignalAlert).where(SignalAlert.sent_at < cutoff))
        await db.commit()
    logger.info("Cleaned up old signal alerts")


async def _check_signals() -> None:
    from app.core.database import AsyncSessionLocal
    from app.models.orm import StrategyResult, Simulation, SymbolPayoutRate, AutoLatest
    from sqlalchemy import select, desc

    async with AsyncSessionLocal() as db:
        # Load user-entered payout rates
        payout_rows = (await db.execute(select(SymbolPayoutRate))).scalars().all()
        payout_map = {r.symbol_display: r.payout_pct / 100.0 for r in payout_rows}
        if not payout_map:
            return

        latest_rows = (await db.execute(select(AutoLatest))).scalars().all()
        if not latest_rows:
            return

        # Collect batch IDs: original batches + their refinement batches
        batch_ids = []
        for row in latest_rows:
            batch_ids.append(row.batch_id)
            ref_id = (await db.execute(
                select(Simulation.refinement_batch_id)
                .where(Simulation.batch_id == row.batch_id)
                .where(Simulation.refinement_batch_id.isnot(None))
                .limit(1)
            )).scalar_one_or_none()
            if ref_id:
                batch_ids.append(ref_id)

        rows = (await db.execute(
            select(StrategyResult, Simulation)
            .join(Simulation, StrategyResult.sim_id == Simulation.id)
            .where(Simulation.batch_id.in_(batch_ids))
            .where(Simulation.status == "COMPLETED")
            .where(StrategyResult.total_trades >= _MIN_TRADES)
            .order_by(desc(StrategyResult.expected_value))
        )).all()

        # Best strategy per symbol+timeframe+duration where consEv > 0
        best: dict[str, dict] = {}
        for r, sim in rows:
            payout = payout_map.get(sim.symbol_display)
            if payout is None:
                continue
            fd = _fixed_discount(r.win_rate, r.total_trades)
            if fd is None:
                continue
            ev = r.win_rate * payout - (1 - r.win_rate)
            cons_ev = ev - fd
            if cons_ev <= 0:
                continue
            key = f"{sim.symbol}|{sim.timeframe}|{sim.trade_duration}"
            if key not in best:
                best[key] = {
                    "symbol": sim.symbol,
                    "symbol_display": sim.symbol_display,
                    "timeframe": sim.timeframe,
                    "trade_duration": sim.trade_duration,
                    "strategy_name": r.strategy_name,
                    "indicator_family": r.indicator_family,
                    "win_rate": r.win_rate,
                    "total_trades": r.total_trades,
                    "cons_ev": cons_ev,
                    "ev": ev,
                    "payout": payout,
                }

    if not best:
        return

    for info in best.values():
        try:
            await _check_one(info)
        except Exception:
            logger.exception("Error checking signal for %s %s", info["symbol_display"], info["timeframe"])
        await asyncio.sleep(0.5)  # avoid bursting APIs


async def _check_one(info: dict) -> None:
    from app.core.database import AsyncSessionLocal
    from app.models.orm import SignalAlert
    from app.services.data_fetcher import fetch_ohlcv
    from app.services.indicator_engine import get_all_strategies, compute_signals
    from sqlalchemy import select

    df = await fetch_ohlcv(info["symbol"], info["timeframe"], 200, fresh=True)
    if df is None or len(df) < 50:
        return

    strategies = get_all_strategies(
        [info["indicator_family"]],
        target_names=[info["strategy_name"]],
    )
    if not strategies:
        return

    loop = asyncio.get_event_loop()
    signals = await loop.run_in_executor(_executor, compute_signals, df, strategies[0])

    # iloc[-2] = last COMPLETED bar (iloc[-1] may still be forming)
    if signals is None or len(signals) < 2:
        return

    sig_val = int(signals.iloc[-2])
    if sig_val == 0:
        return

    bar_ts = int(df["timestamp"].iloc[-2])
    signal_str = "CALL" if sig_val == 1 else "PUT"

    # Deduplication: skip if already notified for this exact bar
    async with AsyncSessionLocal() as db:
        existing = (await db.execute(
            select(SignalAlert)
            .where(SignalAlert.symbol_display == info["symbol_display"])
            .where(SignalAlert.timeframe == info["timeframe"])
            .where(SignalAlert.strategy_name == info["strategy_name"])
            .where(SignalAlert.bar_timestamp == bar_ts)
        )).scalar_one_or_none()
        if existing:
            return

        db.add(SignalAlert(
            symbol_display=info["symbol_display"],
            timeframe=info["timeframe"],
            trade_duration=info["trade_duration"],
            strategy_name=info["strategy_name"],
            signal=signal_str,
            bar_timestamp=bar_ts,
        ))
        await db.commit()

    await _send_alert(info, signal_str)
    logger.info("Signal alert: %s %s %s → %s (consEv=%.3f)",
                info["symbol_display"], info["timeframe"], info["trade_duration"], signal_str, info["cons_ev"])


async def _send_alert(info: dict, signal: str) -> None:
    from app.core.config import settings
    webhook_url = settings.discord_webhook_url
    if not webhook_url:
        return

    signal_emoji = "📈" if signal == "CALL" else "📉"
    tf = _TF_JP.get(info["timeframe"], info["timeframe"])
    po_pct = round(info["payout"] * 100)

    content = (
        f"{signal_emoji} **リアルタイムシグナル**\n"
        f"**{info['symbol_display']}** | {tf} | {info['trade_duration']}分取引 (PO {po_pct}%)\n"
        f"方向: **{'CALL ↑' if signal == 'CALL' else 'PUT ↓'}**\n"
        f"戦略: {info['strategy_name']}\n"
        f"勝率 {round(info['win_rate'] * 100)}% ({info['total_trades']}回)"
        f"  EV: {info['ev']:+.3f}  実効: {info['cons_ev']:+.3f}"
    )

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(webhook_url, json={"content": content})
            resp.raise_for_status()
    except Exception:
        logger.exception("Failed to send signal alert for %s", info["symbol_display"])
