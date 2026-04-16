from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, desc

from app.core.database import get_db
from app.models.orm import StrategyResult, Simulation
from app.models.schemas import ResultsResponse, StrategyResultOut

router = APIRouter(prefix="/results", tags=["results"])


@router.get("/{sim_id}", response_model=ResultsResponse)
async def get_results(
    sim_id: str,
    sort: str = Query(default="win_rate", enum=["win_rate", "total_trades", "profit_factor"]),
    order: str = Query(default="desc", enum=["asc", "desc"]),
    min_trades: int = Query(default=0, ge=0),
    min_win_rate: float = Query(default=0.0, ge=0.0, le=1.0),
    family: Optional[str] = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=10, le=200),
    db: AsyncSession = Depends(get_db),
):
    # Verify simulation exists
    sim_result = await db.execute(select(Simulation).where(Simulation.id == sim_id))
    sim = sim_result.scalar_one_or_none()
    if not sim:
        raise HTTPException(status_code=404, detail="シミュレーションが見つかりません")

    # Count total for this sim
    count_result = await db.execute(
        select(func.count(StrategyResult.id)).where(StrategyResult.sim_id == sim_id)
    )
    total = count_result.scalar()

    # Build filtered query
    query = select(StrategyResult).where(
        StrategyResult.sim_id == sim_id,
        StrategyResult.total_trades >= min_trades,
        StrategyResult.win_rate >= min_win_rate,
    )
    if family:
        query = query.where(StrategyResult.indicator_family == family)

    # Count filtered
    count_filtered = await db.execute(
        select(func.count()).select_from(query.subquery())
    )
    filtered = count_filtered.scalar()

    # Sort
    sort_col = {
        "win_rate": StrategyResult.win_rate,
        "total_trades": StrategyResult.total_trades,
        "profit_factor": StrategyResult.profit_factor,
    }.get(sort, StrategyResult.win_rate)

    if order == "desc":
        query = query.order_by(desc(sort_col), desc(StrategyResult.total_trades))
    else:
        query = query.order_by(sort_col, StrategyResult.total_trades)

    # Paginate
    offset = (page - 1) * page_size
    query = query.offset(offset).limit(page_size)

    rows = (await db.execute(query)).scalars().all()

    return ResultsResponse(
        sim_id=sim_id,
        total=total,
        filtered=filtered,
        page=page,
        page_size=page_size,
        results=[
            StrategyResultOut(
                id=r.id, sim_id=r.sim_id, rank=r.rank,
                strategy_name=r.strategy_name,
                indicator_family=r.indicator_family,
                parameters=r.parameters,
                total_trades=r.total_trades, wins=r.wins, losses=r.losses,
                win_rate=r.win_rate, profit_factor=r.profit_factor,
                signal_bar_count=r.signal_bar_count,
            )
            for r in rows
        ]
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
    best = max(rows, key=lambda r: r.win_rate)

    # Win rate distribution
    buckets = [0] * 10  # 0-10%, 10-20%, ..., 90-100%
    for wr in win_rates:
        idx = min(int(wr * 10), 9)
        buckets[idx] += 1

    return {
        "total_strategies": len(rows),
        "best_win_rate": best.win_rate,
        "best_strategy_name": best.strategy_name,
        "avg_win_rate": sum(win_rates) / len(win_rates),
        "avg_trades": sum(trades) / len(trades),
        "win_rate_distribution": [
            {"range": f"{i*10}-{(i+1)*10}%", "count": buckets[i]}
            for i in range(10)
        ]
    }
