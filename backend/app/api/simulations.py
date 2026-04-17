import uuid
import asyncio
import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.models.orm import Simulation
from app.models.schemas import SimulationCreate, SimulationStatus
from app.workers.simulation_worker import (
    run_simulation, create_progress_queue, remove_progress_queue
)

router = APIRouter(prefix="/simulations", tags=["simulations"])


@router.post("", response_model=SimulationStatus, status_code=202)
async def create_simulation(body: SimulationCreate, db: AsyncSession = Depends(get_db)):
    from app.services.indicator_engine import get_all_strategies
    strategies = get_all_strategies(body.indicators)
    sim_id = str(uuid.uuid4())

    sim = Simulation(
        id=sim_id,
        symbol=body.symbol,
        symbol_display=body.symbol_display,
        timeframe=body.timeframe,
        trade_duration=body.trade_duration,
        indicators=json.dumps(body.indicators),
        status="PENDING",
        total_strategies=len(strategies),
    )
    db.add(sim)
    await db.commit()
    await db.refresh(sim)

    create_progress_queue(sim_id)

    # Start background task (worker creates its own DB session)
    asyncio.create_task(run_simulation(sim_id, body))

    return SimulationStatus(
        id=sim.id,
        symbol=sim.symbol,
        symbol_display=sim.symbol_display,
        timeframe=sim.timeframe,
        trade_duration=sim.trade_duration,
        status=sim.status,
        progress_pct=sim.progress_pct,
        total_strategies=sim.total_strategies,
        total_bars=sim.total_bars,
        error_message=sim.error_message,
        created_at=sim.created_at,
        completed_at=sim.completed_at,
    )


@router.get("/{sim_id}", response_model=SimulationStatus)
async def get_simulation(sim_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Simulation).where(Simulation.id == sim_id))
    sim = result.scalar_one_or_none()
    if not sim:
        raise HTTPException(status_code=404, detail="シミュレーションが見つかりません")

    return SimulationStatus(
        id=sim.id,
        symbol=sim.symbol,
        symbol_display=sim.symbol_display,
        timeframe=sim.timeframe,
        trade_duration=sim.trade_duration,
        status=sim.status,
        progress_pct=sim.progress_pct,
        total_strategies=sim.total_strategies,
        total_bars=sim.total_bars,
        error_message=sim.error_message,
        created_at=sim.created_at,
        completed_at=sim.completed_at,
    )


@router.get("", response_model=list[SimulationStatus])
async def list_simulations(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Simulation).order_by(Simulation.created_at.desc()).limit(20)
    )
    sims = result.scalars().all()
    return [
        SimulationStatus(
            id=s.id, symbol=s.symbol, symbol_display=s.symbol_display,
            timeframe=s.timeframe, trade_duration=s.trade_duration,
            status=s.status, progress_pct=s.progress_pct,
            total_strategies=s.total_strategies, total_bars=s.total_bars,
            error_message=s.error_message,
            created_at=s.created_at, completed_at=s.completed_at,
        )
        for s in sims
    ]
