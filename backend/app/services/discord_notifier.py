"""
Discord webhook notifier.
Sends a signal alert when an auto-analysis batch completes with positive 実効EV strategies.
Per-symbol payout rates entered by the user in the UI are read from DB.
Symbols with no stored payout rate are skipped.
"""
import math
import logging

import httpx

logger = logging.getLogger(__name__)

_REFERENCE_PAYOUT = 0.80
_Z = 0.674  # 75% one-tailed CI


def _fixed_discount(win_rate: float, total_trades: int) -> float | None:
    if total_trades < 10:
        return None
    se = math.sqrt(win_rate * (1 - win_rate) / total_trades)
    p_stat = win_rate - _Z * se
    decay = 0.90 if total_trades >= 100 else 0.85 if total_trades >= 50 else 0.80
    p_cons = 0.5 + (p_stat - 0.5) * decay
    ev_raw = win_rate * _REFERENCE_PAYOUT - (1 - win_rate)
    ev_cons = p_cons * _REFERENCE_PAYOUT - (1 - p_cons)
    return max(0.0, ev_raw - ev_cons)


_TF_JP = {"1m": "1分足", "5m": "5分足", "15m": "15分足", "1h": "1時間足"}
_CAT_JP = {"crypto": "暗号資産", "forex": "為替"}
_MIN_TRADES = 20


async def notify_signals(batch_id: str, category: str) -> None:
    from app.core.config import settings
    webhook_url = settings.discord_webhook_url
    if not webhook_url:
        return

    from app.core.database import AsyncSessionLocal
    from app.models.orm import StrategyResult, Simulation, SymbolPayoutRate
    from sqlalchemy import select

    async with AsyncSessionLocal() as db:
        sims = (await db.execute(
            select(Simulation)
            .where(Simulation.batch_id == batch_id)
            .where(Simulation.status == "COMPLETED")
        )).scalars().all()
        if not sims:
            return

        payout_rows = (await db.execute(select(SymbolPayoutRate))).scalars().all()
        payout_map: dict[str, float] = {r.symbol_display: r.payout_pct / 100.0 for r in payout_rows}

        sim_ids = [s.id for s in sims]
        results = (await db.execute(
            select(StrategyResult)
            .where(StrategyResult.sim_id.in_(sim_ids))
            .where(StrategyResult.total_trades >= _MIN_TRADES)
        )).scalars().all()

    sim_map = {s.id: s for s in sims}

    # Pick best (highest consEv) strategy per symbol+timeframe+duration
    best: dict[str, tuple] = {}
    for r in results:
        sim = sim_map.get(r.sim_id)
        if not sim:
            continue
        payout = payout_map.get(sim.symbol_display)
        if payout is None:
            continue  # no user-entered payout rate — skip
        ev = r.win_rate * payout - (1 - r.win_rate)
        fd = _fixed_discount(r.win_rate, r.total_trades)
        if fd is None:
            continue
        cons_ev = ev - fd
        if cons_ev <= 0:
            continue
        key = f"{sim.symbol_display}|{sim.timeframe}|{sim.trade_duration}"
        if key not in best or cons_ev > best[key][0]:
            best[key] = (cons_ev, ev, r, sim, payout)

    if not best:
        logger.info("No positive consEv signals for batch %s (%s)", batch_id, category)
        return

    cat_label = _CAT_JP.get(category, category)
    lines = [f"🎯 **シグナル通知** — {cat_label}\n"]

    for cons_ev, ev, r, sim, payout in sorted(best.values(), key=lambda x: x[0], reverse=True)[:10]:
        tf = _TF_JP.get(sim.timeframe, sim.timeframe)
        po_pct = round(payout * 100)
        lines.append(
            f"✅ **{sim.symbol_display}** | {tf} | {sim.trade_duration}分取引 (PO {po_pct}%)\n"
            f"　{r.strategy_name}\n"
            f"　勝率 {round(r.win_rate * 100)}% ({r.total_trades}回)"
            f"　EV: {ev:+.3f}　実効: {cons_ev:+.3f}"
        )

    content = "\n".join(lines)
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(webhook_url, json={"content": content})
            resp.raise_for_status()
        logger.info("Discord notification sent: batch=%s category=%s signals=%d",
                    batch_id, category, len(best))
    except Exception:
        logger.exception("Failed to send Discord notification for batch %s", batch_id)
