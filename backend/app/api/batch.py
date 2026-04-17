import asyncio
import json
import uuid
import logging
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.models.orm import Simulation, StrategyResult
from app.models.schemas import BatchCreate, BatchSimStatus, BatchResultsResponse, SimulationStatus
from app.workers.simulation_worker import run_simulation

logger = logging.getLogger(__name__)
router = APIRouter()

BATCH_TIMEFRAMES = ["1m", "5m", "15m", "1h"]
BATCH_DURATIONS = [1, 5]


@router.post("/batch", status_code=202)
async def create_batch(body: BatchCreate, db: AsyncSession = Depends(get_db)):
    batch_id = str(uuid.uuid4())
    sim_ids: List[str] = []

    for tf in BATCH_TIMEFRAMES:
        for dur in BATCH_DURATIONS:
            sim_id = str(uuid.uuid4())
            sim = Simulation(
                id=sim_id,
                symbol=body.symbol,
                symbol_display=body.symbol_display,
                timeframe=tf,
                trade_duration=dur,
                indicators=json.dumps(body.indicators),
                status="PENDING",
                progress_pct=0,
                batch_id=batch_id,
            )
            db.add(sim)
            sim_ids.append(sim_id)

    await db.commit()

    for sim_id in sim_ids:
        asyncio.create_task(run_simulation(sim_id))

    return {"batch_id": batch_id, "sim_ids": sim_ids, "total": len(sim_ids)}


@router.get("/batch/{batch_id}", response_model=BatchSimStatus)
async def get_batch(batch_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Simulation).where(Simulation.batch_id == batch_id)
    )
    sims = result.scalars().all()
    if not sims:
        raise HTTPException(status_code=404, detail="Batch not found")

    completed = sum(1 for s in sims if s.status == "COMPLETED")
    failed = sum(1 for s in sims if s.status == "FAILED")

    sim_statuses = [SimulationStatus.model_validate(s.__dict__) for s in sims]

    return BatchSimStatus(
        batch_id=batch_id,
        total=len(sims),
        completed=completed,
        failed=failed,
        simulations=sim_statuses,
    )


@router.get("/batch/{batch_id}/results", response_model=BatchResultsResponse)
async def get_batch_results(batch_id: str, min_trades: int = 10, db: AsyncSession = Depends(get_db)):
    sim_result = await db.execute(
        select(Simulation).where(Simulation.batch_id == batch_id)
    )
    sims = sim_result.scalars().all()
    if not sims:
        raise HTTPException(status_code=404, detail="Batch not found")

    symbol = sims[0].symbol
    symbol_display = sims[0].symbol_display

    # Build results_by_tf: {"1m": {"1": [...top10...], "5": [...top10...]}, ...}
    results_by_tf: dict = {}
    for tf in BATCH_TIMEFRAMES:
        results_by_tf[tf] = {}
        for dur in BATCH_DURATIONS:
            sim = next((s for s in sims if s.timeframe == tf and s.trade_duration == dur), None)
            if sim is None or sim.status != "COMPLETED":
                results_by_tf[tf][str(dur)] = []
                continue

            rows = await db.execute(
                select(StrategyResult)
                .where(StrategyResult.sim_id == sim.id)
                .where(StrategyResult.total_trades >= min_trades)
                .order_by(StrategyResult.win_rate.desc())
                .limit(10)
            )
            strategies = rows.scalars().all()
            results_by_tf[tf][str(dur)] = [
                {
                    "id": r.id,
                    "sim_id": r.sim_id,
                    "timeframe": tf,
                    "trade_duration": dur,
                    "rank": r.rank,
                    "strategy_name": r.strategy_name,
                    "indicator_family": r.indicator_family,
                    "parameters": r.parameters,
                    "total_trades": r.total_trades,
                    "wins": r.wins,
                    "losses": r.losses,
                    "win_rate": r.win_rate,
                    "profit_factor": r.profit_factor,
                }
                for r in strategies
            ]

    return BatchResultsResponse(
        batch_id=batch_id,
        symbol=symbol,
        symbol_display=symbol_display,
        results_by_tf=results_by_tf,
    )
