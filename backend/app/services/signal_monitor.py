"""
Real-time signal monitor.
Runs every 60 seconds. For each strategy with consEv > 0 (using user-entered payout rates),
fetches fresh OHLCV data and checks the last completed bar for signals.

Data sources:
- Forex  → Twelve Data REST API (real-time, ~1-2s delay)
- Crypto → Binance via ccxt (unchanged)

Credit budget: Twelve Data free plan = 800 credits/day.
Only call when a new bar is due (timeframe-aware) to stay within budget.
"""
import asyncio
import logging
import math
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import httpx

logger = logging.getLogger(__name__)

MONITOR_INTERVAL = 60  # seconds

_REFERENCE_PAYOUT = 0.80
_Z = 0.674
_MIN_TRADES = 20
_TF_JP = {"1m": "1分足", "5m": "5分足", "15m": "15分足", "1h": "1時間足"}
_TF_SECONDS = {"1m": 60, "5m": 300, "15m": 900, "1h": 3600}

# Twelve Data credit budget guard
_DAILY_CREDITS = 0
_CREDITS_RESET_DAY = -1
_DAILY_BUDGET = 700  # leave 100 buffer from 800 limit

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


def _bar_is_due(timeframe: str) -> bool:
    """True if a bar of this timeframe closed within the last 90 seconds."""
    interval = _TF_SECONDS.get(timeframe, 60)
    if interval <= 60:
        return True  # 1m bars: always check (crypto only)
    return (int(time.time()) % interval) < 90


def _use_credit() -> bool:
    """Returns True if we have remaining Twelve Data credits today."""
    global _DAILY_CREDITS, _CREDITS_RESET_DAY
    today = datetime.now(timezone.utc).timetuple().tm_yday
    if today != _CREDITS_RESET_DAY:
        _DAILY_CREDITS = 0
        _CREDITS_RESET_DAY = today
    if _DAILY_CREDITS >= _DAILY_BUDGET:
        logger.warning("Twelve Data daily budget (%d) reached, skipping forex check", _DAILY_BUDGET)
        return False
    _DAILY_CREDITS += 1
    return True


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
            if check_count % 1440 == 0:
                await _cleanup_old_alerts()
        except Exception:
            logger.exception("Signal monitor check failed")
        await asyncio.sleep(MONITOR_INTERVAL)


async def _cleanup_old_alerts() -> None:
    from app.core.database import AsyncSessionLocal
    from app.models.orm import SignalAlert
    from sqlalchemy import delete
    from datetime import timedelta

    cutoff = datetime.now(timezone.utc) - timedelta(days=7)
    async with AsyncSessionLocal() as db:
        await db.execute(delete(SignalAlert).where(SignalAlert.sent_at < cutoff))
        await db.commit()
    logger.info("Cleaned up old signal alerts")


async def _check_signals() -> None:
    from app.core.database import AsyncSessionLocal
    from app.models.orm import StrategyResult, Simulation, SymbolPayoutRate, AutoLatest
    from app.services.data_fetcher import SYMBOL_MAP
    from sqlalchemy import select, desc

    async with AsyncSessionLocal() as db:
        payout_rows = (await db.execute(select(SymbolPayoutRate))).scalars().all()
        payout_map = {r.symbol_display: r.payout_pct / 100.0 for r in payout_rows}
        if not payout_map:
            return

        latest_rows = (await db.execute(select(AutoLatest))).scalars().all()
        if not latest_rows:
            return

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
                src = SYMBOL_MAP.get(sim.symbol.upper(), {}).get("source", "")
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
                    "is_forex": src == "yfinance",
                }

    if not best:
        return

    for info in best.values():
        # For forex: only fetch when a new bar is due (saves Twelve Data credits)
        if info["is_forex"] and not _bar_is_due(info["timeframe"]):
            continue
        # For forex: check daily credit budget
        if info["is_forex"] and not _use_credit():
            break

        try:
            await _check_one(info)
        except Exception:
            logger.exception("Error checking signal for %s %s", info["symbol_display"], info["timeframe"])
        await asyncio.sleep(0.5)


async def _check_one(info: dict) -> None:
    from app.core.database import AsyncSessionLocal
    from app.models.orm import SignalAlert
    from app.services.data_fetcher import fetch_ohlcv_realtime
    from app.services.indicator_engine import get_all_strategies, compute_signals
    from sqlalchemy import select

    df = await fetch_ohlcv_realtime(info["symbol"], info["timeframe"], 200)
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

    if signals is None or len(signals) < 2:
        return

    sig_val = int(signals.iloc[-2])
    if sig_val == 0:
        return

    bar_ts = int(df["timestamp"].iloc[-2])
    signal_str = "CALL" if sig_val == 1 else "PUT"

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
    logger.info("Signal alert: %s %s %sm → %s (consEv=%.3f)",
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
