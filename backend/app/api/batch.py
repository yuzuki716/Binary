import asyncio
import json
import uuid
import logging
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

BARS_PER_HOUR = {"1m": 60, "5m": 12, "15m": 4, "1h": 1, "4h": 0.25, "1d": 1/24}


def _hourly_ev(ev, timeframe, total_bars):
    if ev is None or not timeframe or not total_bars:
        return None
    bph = BARS_PER_HOUR.get(timeframe)
    if not bph:
        return None
    return round(ev * bph / total_bars, 4)

from app.core.database import get_db
from app.models.orm import Simulation, StrategyResult
from app.models.schemas import (
    BatchCreate, BatchSimStatus, BatchResultsResponse, SimulationStatus
)
from app.workers.simulation_worker import run_simulation
from app.models.schemas import SimulationCreate

logger = logging.getLogger(__name__)
router = APIRouter()

BATCH_DURATIONS = [1, 5]

# Crypto keeps 1m timeframe (Binance = real-time). Forex drops 1m (yfinance delay makes it unreliable).
CATEGORY_TIMEFRAMES: dict[str, list[str]] = {
    "crypto": ["1m", "5m", "15m", "1h"],
    "forex":  ["5m", "15m", "1h"],
}

# Crypto binary options require 5+ minute trades
CATEGORY_DURATIONS: dict[str, list[int]] = {
    "crypto": [5],
    "forex":  [1, 5],
}

# All symbols per category (mirrors data_fetcher.SYMBOL_MAP)
CATEGORY_SYMBOLS: dict[str, list[dict]] = {
    "crypto": [
        {"key": "BTCUSDT",  "display": "Bitcoin"},
        {"key": "DOGEUSDT", "display": "Dogecoin"},
        {"key": "SOLUSDT",  "display": "Solana"},
        {"key": "BNBUSDT",  "display": "BNB"},
    ],
    "forex": [
        {"key": "EURUSD", "display": "EUR/USD"},
        {"key": "GBPJPY", "display": "GBP/JPY"},
        {"key": "AUDJPY", "display": "AUD/JPY"},
        {"key": "NZDJPY", "display": "NZD/JPY"},
        {"key": "USDJPY", "display": "USD/JPY"},
        {"key": "EURGBP", "display": "EUR/GBP"},
        {"key": "AUDNZD", "display": "AUD/NZD"},
        {"key": "USDCHF", "display": "USD/CHF"},
        {"key": "GBPUSD", "display": "GBP/USD"},
        {"key": "GBPCHF", "display": "GBP/CHF"},
    ],
}

CATEGORY_LABELS = {"crypto": "暗号資産", "forex": "為替"}


async def _create_and_launch_sims(
    db: AsyncSession,
    batch_id: str,
    symbols: list[dict],
    timeframes: list[str],
    durations: list[int],
    indicators: list[str],
    bar_limit: int,
    payout_rates: dict = None,
) -> list[str]:
    sim_ids: List[str] = []
    for sym in symbols:
        payout_rate = (payout_rates or {}).get(sym["key"])
        for tf in timeframes:
            for dur in durations:
                sim_id = str(uuid.uuid4())
                sim = Simulation(
                    id=sim_id,
                    symbol=sym["key"],
                    symbol_display=sym["display"],
                    timeframe=tf,
                    trade_duration=dur,
                    indicators=json.dumps(indicators),
                    status="PENDING",
                    progress_pct=0,
                    batch_id=batch_id,
                    payout_rate=payout_rate,
                )
                db.add(sim)
                sim_ids.append((sim_id, sym, tf, dur, payout_rate))
    await db.commit()

    for sim_id, sym, tf, dur, payout_rate in sim_ids:
        config = SimulationCreate(
            symbol=sym["key"],
            symbol_display=sym["display"],
            timeframe=tf,
            trade_duration=dur,
            indicators=indicators,
            bar_limit=bar_limit,
            payout_rate=payout_rate,
        )
        asyncio.create_task(run_simulation(sim_id, config))

    return [s for s, *_ in sim_ids]


# ── Single-symbol batch (4 TF × 2 duration) ────────────────────────────────

@router.post("/batch", status_code=202)
async def create_batch(body: BatchCreate, db: AsyncSession = Depends(get_db)):
    batch_id = str(uuid.uuid4())
    sym = {"key": body.symbol, "display": body.symbol_display}
    from app.services.data_fetcher import SYMBOL_MAP
    category = SYMBOL_MAP.get(body.symbol.upper(), {}).get("category", "crypto")
    timeframes = CATEGORY_TIMEFRAMES.get(category, ["5m", "15m", "1h"])
    durations = CATEGORY_DURATIONS.get(category, BATCH_DURATIONS)
    await _create_and_launch_sims(
        db, batch_id, [sym], timeframes, durations,
        body.indicators, body.bar_limit,
    )
    return {"batch_id": batch_id, "total": len(timeframes) * len(durations)}


# ── Category batch (all symbols in group × 4 TF × 2 duration) ──────────────

@router.post("/category-batch", status_code=202)
async def create_category_batch(
    category: str,
    body: BatchCreate,
    db: AsyncSession = Depends(get_db),
):
    symbols = CATEGORY_SYMBOLS.get(category)
    if not symbols:
        raise HTTPException(400, f"Unknown category: {category}. Use crypto/forex/indices.")

    batch_id = str(uuid.uuid4())
    timeframes = CATEGORY_TIMEFRAMES.get(category, ["5m", "15m", "1h"])
    durations = CATEGORY_DURATIONS.get(category, BATCH_DURATIONS)
    await _create_and_launch_sims(
        db, batch_id, symbols, timeframes, durations,
        body.indicators, body.bar_limit,
        payout_rates=body.payout_rates,
    )
    total = len(symbols) * len(timeframes) * len(durations)
    return {
        "batch_id": batch_id,
        "category": category,
        "category_label": CATEGORY_LABELS.get(category, category),
        "symbol_count": len(symbols),
        "total": total,
    }


# ── Status ──────────────────────────────────────────────────────────────────

@router.get("/batch/{batch_id}")
async def get_batch(batch_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Simulation).where(Simulation.batch_id == batch_id)
    )
    sims = result.scalars().all()
    if not sims:
        raise HTTPException(status_code=404, detail="Batch not found")

    completed = sum(1 for s in sims if s.status == "COMPLETED")
    failed = sum(1 for s in sims if s.status == "FAILED")
    refinement_batch_id = next((s.refinement_batch_id for s in sims if s.refinement_batch_id), None)

    sim_statuses = [
        {
            "id": s.id, "symbol": s.symbol, "symbol_display": s.symbol_display,
            "timeframe": s.timeframe, "trade_duration": s.trade_duration,
            "status": s.status, "progress_pct": s.progress_pct,
            "total_strategies": s.total_strategies, "total_bars": s.total_bars,
            "error_message": s.error_message,
            "created_at": s.created_at, "completed_at": s.completed_at,
        }
        for s in sims
    ]

    return {
        "batch_id": batch_id,
        "total": len(sims),
        "completed": completed,
        "failed": failed,
        "refinement_batch_id": refinement_batch_id,
        "simulations": sim_statuses,
    }


# ── TF-grouped results (single-symbol batch) ────────────────────────────────

@router.get("/batch/{batch_id}/results", response_model=BatchResultsResponse)
async def get_batch_results(
    batch_id: str,
    min_trades: int = 10,
    min_win_rate: float = Query(default=0.55, ge=0.0, le=1.0),
    db: AsyncSession = Depends(get_db),
):
    sim_result = await db.execute(
        select(Simulation).where(Simulation.batch_id == batch_id)
    )
    sims = sim_result.scalars().all()
    if not sims:
        raise HTTPException(status_code=404, detail="Batch not found")

    symbol = sims[0].symbol
    symbol_display = sims[0].symbol_display

    from app.services.data_fetcher import SYMBOL_MAP as _SM
    _cat = _SM.get(symbol.upper(), {}).get("category", "crypto")
    _tfs = CATEGORY_TIMEFRAMES.get(_cat, ["5m", "15m", "1h"])

    results_by_tf: dict = {}
    for tf in _tfs:
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
                .where(StrategyResult.win_rate >= min_win_rate)
                .order_by(StrategyResult.expected_value.desc(), StrategyResult.total_trades.desc())
                .limit(10)
            )
            results_by_tf[tf][str(dur)] = [
                {
                    "id": r.id, "sim_id": r.sim_id,
                    "timeframe": tf, "trade_duration": dur,
                    "rank": r.rank, "strategy_name": r.strategy_name,
                    "indicator_family": r.indicator_family, "parameters": r.parameters,
                    "total_trades": r.total_trades, "wins": r.wins, "losses": r.losses,
                    "win_rate": r.win_rate, "profit_factor": r.profit_factor,
                    "expected_value": r.expected_value,
                    "hourly_ev": _hourly_ev(r.expected_value, r.timeframe or tf, r.total_bars),
                }
                for r in rows.scalars().all()
            ]

    return BatchResultsResponse(
        batch_id=batch_id,
        symbol=symbol,
        symbol_display=symbol_display,
        results_by_tf=results_by_tf,
    )


# ── Per-symbol summary (category batch) ─────────────────────────────────────

@router.get("/batch/{batch_id}/symbol-summary")
async def get_symbol_summary(
    batch_id: str,
    min_trades: int = 10,
    min_win_rate: float = Query(default=0.55, ge=0.0, le=1.0),
    db: AsyncSession = Depends(get_db),
):
    sim_result = await db.execute(
        select(Simulation).where(Simulation.batch_id == batch_id)
    )
    sims = sim_result.scalars().all()
    if not sims:
        raise HTTPException(status_code=404, detail="Batch not found")

    total = len(sims)
    completed = sum(1 for s in sims if s.status == "COMPLETED")
    failed = sum(1 for s in sims if s.status == "FAILED")

    # Group simulations by symbol
    symbols_seen: list[str] = []
    sym_map: dict = {}
    for s in sims:
        if s.symbol not in sym_map:
            symbols_seen.append(s.symbol)
            sym_map[s.symbol] = {"symbol": s.symbol, "symbol_display": s.symbol_display, "sims": []}
        sym_map[s.symbol]["sims"].append(s)

    symbol_results = []
    for sym_key in symbols_seen:
        entry = sym_map[sym_key]
        sym_sims = entry["sims"]

        # Status grid: {tf: {dur: status/pct}}
        grid: dict = {}
        for s in sym_sims:
            grid.setdefault(s.timeframe, {})[str(s.trade_duration)] = {
                "sim_id": s.id, "status": s.status, "progress_pct": s.progress_pct
            }

        # Find the single best strategy across all completed sims for this symbol
        top_strategy = None
        for s in sym_sims:
            if s.status != "COMPLETED":
                continue
            row = (await db.execute(
                select(StrategyResult)
                .where(StrategyResult.sim_id == s.id)
                .where(StrategyResult.total_trades >= min_trades)
                .where(StrategyResult.win_rate >= min_win_rate)
                .order_by(StrategyResult.expected_value.desc(), StrategyResult.total_trades.desc())
                .limit(1)
            )).scalar_one_or_none()
            if row and (top_strategy is None or (row.expected_value or 0) > top_strategy.get("expected_value", 0)):
                hev = _hourly_ev(row.expected_value, row.timeframe or s.timeframe, row.total_bars)
                top_strategy = {
                    "id": row.id,
                    "sim_id": row.sim_id,
                    "strategy_name": row.strategy_name,
                    "timeframe": s.timeframe,
                    "trade_duration": s.trade_duration,
                    "win_rate": row.win_rate,
                    "total_trades": row.total_trades,
                    "wins": row.wins,
                    "losses": row.losses,
                    "parameters": row.parameters,
                    "expected_value": row.expected_value,
                    "hourly_ev": hev,
                }

        symbol_results.append({
            "symbol": sym_key,
            "symbol_display": entry["symbol_display"],
            "grid": grid,
            "top_strategy": top_strategy,
        })

    refinement_batch_id = next((s.refinement_batch_id for s in sims if s.refinement_batch_id), None)

    return {
        "batch_id": batch_id,
        "total": total,
        "completed": completed,
        "failed": failed,
        "refinement_batch_id": refinement_batch_id,
        "symbols": symbol_results,
    }
