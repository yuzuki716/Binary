import math
import time

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc

from app.core.database import get_db
from app.models.orm import AutoLatest, SymbolPayoutRate, StrategyResult, Simulation
from app.services.auto_scheduler import get_scheduler_status

router = APIRouter()


@router.get("/auto/latest")
async def get_auto_latest(db: AsyncSession = Depends(get_db)):
    """Return the latest auto-analysis batch ID and timestamps per category."""
    rows = (await db.execute(select(AutoLatest))).scalars().all()

    categories: dict = {}
    for row in rows:
        categories[row.category] = {
            "batch_id": row.batch_id,
            "created_at": row.created_at,
            "next_run_at": row.next_run_at,
        }

    status = get_scheduler_status()
    return {
        "categories": categories,
        "is_running": status["is_running"],
        "next_run_at": status["next_run_at"],
    }


@router.get("/auto/monitor-debug")
async def monitor_debug(db: AsyncSession = Depends(get_db)):
    """Debug endpoint: shows payout rates in DB, qualifying strategies, and bar timings."""
    _Z = 0.674
    _MIN_TRADES = 20
    _REFERENCE_PAYOUT = 0.80
    _TF_SECONDS = {"1m": 60, "5m": 300, "15m": 900, "1h": 3600}

    # Payout rates in DB
    payout_rows = (await db.execute(select(SymbolPayoutRate))).scalars().all()
    payout_map = {r.symbol_display: r.payout_pct / 100.0 for r in payout_rows}

    # Latest batch IDs
    latest_rows = (await db.execute(select(AutoLatest))).scalars().all()
    batch_ids = [r.batch_id for r in latest_rows]

    # Qualifying strategies (consEv > 0)
    qualifying = []
    if payout_map and batch_ids:
        rows = (await db.execute(
            select(StrategyResult, Simulation)
            .join(Simulation, StrategyResult.sim_id == Simulation.id)
            .where(Simulation.batch_id.in_(batch_ids))
            .where(Simulation.status == "COMPLETED")
            .where(StrategyResult.total_trades >= _MIN_TRADES)
            .order_by(desc(StrategyResult.expected_value))
        )).all()

        seen: set = set()
        for r, sim in rows:
            key = f"{sim.symbol}|{sim.timeframe}|{sim.trade_duration}"
            if key in seen:
                continue
            payout = payout_map.get(sim.symbol_display)
            if payout is None:
                continue
            se = math.sqrt(r.win_rate * (1 - r.win_rate) / r.total_trades)
            p_stat = r.win_rate - _Z * se
            decay = 0.90 if r.total_trades >= 100 else 0.85 if r.total_trades >= 50 else 0.80
            p_cons = 0.5 + (p_stat - 0.5) * decay
            ev_raw = r.win_rate * _REFERENCE_PAYOUT - (1 - r.win_rate)
            ev_cons = p_cons * _REFERENCE_PAYOUT - (1 - p_cons)
            fd = max(0.0, ev_raw - ev_cons)
            ev = r.win_rate * payout - (1 - r.win_rate)
            cons_ev = ev - fd
            if cons_ev > 0:
                seen.add(key)
                interval = _TF_SECONDS.get(sim.timeframe, 60)
                secs_to_close = interval - (int(time.time()) % interval)
                qualifying.append({
                    "symbol_display": sim.symbol_display,
                    "timeframe": sim.timeframe,
                    "strategy_name": r.strategy_name,
                    "win_rate": round(r.win_rate, 3),
                    "cons_ev": round(cons_ev, 4),
                    "secs_to_bar_close": secs_to_close,
                    "in_pre_close_window": 9 <= secs_to_close < 11,
                })

    # Bar close countdowns
    now = int(time.time())
    bar_timings = {
        tf: {"interval": secs, "secs_to_close": secs - (now % secs)}
        for tf, secs in _TF_SECONDS.items()
    }

    return {
        "payout_rates_in_db": {k: round(v * 100) for k, v in payout_map.items()},
        "payout_count": len(payout_map),
        "qualifying_strategies": qualifying,
        "qualifying_count": len(qualifying),
        "bar_timings": bar_timings,
    }


@router.post("/auto/notify-test")
async def notify_test():
    """Send a test Discord notification to verify webhook configuration."""
    from app.core.config import settings
    import httpx

    webhook_url = settings.discord_webhook_url
    if not webhook_url:
        return {"ok": False, "error": "DISCORD_WEBHOOK_URL が設定されていません"}

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(webhook_url, json={
                "content": "✅ **テスト通知** — Binary Options Simulator から正常に通知を受信できています！"
            })
            resp.raise_for_status()
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}
