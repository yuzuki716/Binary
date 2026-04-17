from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, desc

from app.core.database import get_db
from app.models.orm import StrategyResult, Simulation
from app.models.schemas import ResultsResponse, StrategyResultOut

router = APIRouter(prefix="/results", tags=["results"])

BARS_PER_HOUR = {"1m": 60, "5m": 12, "15m": 4, "1h": 1, "4h": 0.25, "1d": 1/24}


def _hourly_ev(r: StrategyResult) -> Optional[float]:
    if r.expected_value is None or not r.timeframe or not r.total_bars:
        return None
    bph = BARS_PER_HOUR.get(r.timeframe)
    if not bph:
        return None
    return round(r.expected_value * bph / r.total_bars, 4)


def _to_out(r: StrategyResult) -> StrategyResultOut:
    return StrategyResultOut(
        id=r.id, sim_id=r.sim_id, rank=r.rank,
        strategy_name=r.strategy_name,
        indicator_family=r.indicator_family,
        parameters=r.parameters,
        total_trades=r.total_trades, wins=r.wins, losses=r.losses,
        win_rate=r.win_rate, profit_factor=r.profit_factor,
        expected_value=r.expected_value,
        hourly_ev=_hourly_ev(r),
        signal_bar_count=r.signal_bar_count,
    )


@router.get("/{sim_id}", response_model=ResultsResponse)
async def get_results(
    sim_id: str,
    sort: str = Query(default="expected_value", enum=["win_rate", "total_trades", "profit_factor", "expected_value"]),
    order: str = Query(default="desc", enum=["asc", "desc"]),
    min_trades: int = Query(default=0, ge=0),
    min_win_rate: float = Query(default=0.55, ge=0.0, le=1.0),
    family: Optional[str] = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=10, le=200),
    db: AsyncSession = Depends(get_db),
):
    sim_result = await db.execute(select(Simulation).where(Simulation.id == sim_id))
    sim = sim_result.scalar_one_or_none()
    if not sim:
        raise HTTPException(status_code=404, detail="シミュレーションが見つかりません")

    count_result = await db.execute(
        select(func.count(StrategyResult.id)).where(StrategyResult.sim_id == sim_id)
    )
    total = count_result.scalar()

    query = select(StrategyResult).where(
        StrategyResult.sim_id == sim_id,
        StrategyResult.total_trades >= min_trades,
        StrategyResult.win_rate >= min_win_rate,
    )
    if family:
        query = query.where(StrategyResult.indicator_family == family)

    count_filtered = await db.execute(select(func.count()).select_from(query.subquery()))
    filtered = count_filtered.scalar()

    sort_col = {
        "win_rate": StrategyResult.win_rate,
        "total_trades": StrategyResult.total_trades,
        "profit_factor": StrategyResult.profit_factor,
        "expected_value": StrategyResult.expected_value,
    }.get(sort, StrategyResult.expected_value)

    if order == "desc":
        query = query.order_by(desc(sort_col), desc(StrategyResult.total_trades))
    else:
        query = query.order_by(sort_col, StrategyResult.total_trades)

    offset = (page - 1) * page_size
    rows = (await db.execute(query.offset(offset).limit(page_size))).scalars().all()

    return ResultsResponse(
        sim_id=sim_id, total=total, filtered=filtered, page=page, page_size=page_size,
        results=[_to_out(r) for r in rows],
    )


@router.get("/{sim_id}/summary")
async def get_summary(sim_id: str, db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(StrategyResult).where(StrategyResult.sim_id == sim_id)
    )).scalars().all()

    if not rows:
        raise HTTPException(status_code=404, detail="結果が見つかりません")

    win_rates = [r.win_rate for r in rows]
    trades = [r.total_trades for r in rows]
    evs = [r.expected_value for r in rows if r.expected_value is not None]
    best = max(rows, key=lambda r: r.expected_value or 0)

    buckets = [0] * 10
    for wr in win_rates:
        idx = min(int(wr * 10), 9)
        buckets[idx] += 1

    return {
        "total_strategies": len(rows),
        "best_win_rate": best.win_rate,
        "best_strategy_name": best.strategy_name,
        "best_expected_value": best.expected_value,
        "best_hourly_ev": _hourly_ev(best),
        "avg_win_rate": sum(win_rates) / len(win_rates),
        "avg_trades": sum(trades) / len(trades),
        "avg_expected_value": sum(evs) / len(evs) if evs else None,
        "win_rate_distribution": [
            {"range": f"{i*10}-{(i+1)*10}%", "count": buckets[i]}
            for i in range(10)
        ]
    }
