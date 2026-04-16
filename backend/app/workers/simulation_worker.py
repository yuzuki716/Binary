"""
Background simulation worker.
Runs the full strategy grid search in a thread pool and streams progress via asyncio Queue.
"""
import asyncio
import json
import logging
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Dict, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.orm import Simulation, StrategyResult
from app.models.schemas import SimulationCreate
from app.services.data_fetcher import fetch_ohlcv
from app.services.indicator_engine import get_all_strategies, compute_signals
from app.services.backtest_engine import run_backtest

logger = logging.getLogger(__name__)

# Map of sim_id -> asyncio.Queue for progress events
_progress_queues: Dict[str, asyncio.Queue] = {}

_executor = ThreadPoolExecutor(max_workers=4)


def get_progress_queue(sim_id: str) -> Optional[asyncio.Queue]:
    return _progress_queues.get(sim_id)


def create_progress_queue(sim_id: str) -> asyncio.Queue:
    q = asyncio.Queue(maxsize=200)
    _progress_queues[sim_id] = q
    return q


def remove_progress_queue(sim_id: str):
    _progress_queues.pop(sim_id, None)


async def run_simulation(sim_id: str, config: SimulationCreate, db: AsyncSession):
    """Main simulation coroutine. Runs in background via asyncio.create_task."""
    queue = get_progress_queue(sim_id)

    async def progress(pct: int, msg: str):
        if queue:
            try:
                queue.put_nowait({"type": "progress", "percent": pct, "message": msg})
            except asyncio.QueueFull:
                pass
        # Update DB
        from sqlalchemy import update
        await db.execute(
            update(Simulation)
            .where(Simulation.id == sim_id)
            .values(progress_pct=pct)
        )
        await db.commit()

    try:
        # Update status to RUNNING
        from sqlalchemy import update
        await db.execute(
            update(Simulation)
            .where(Simulation.id == sim_id)
            .values(status="RUNNING", progress_pct=0)
        )
        await db.commit()

        await progress(5, "価格データを取得中...")
        df = await fetch_ohlcv(config.symbol, config.timeframe, config.bar_limit)

        if df is None or len(df) < 50:
            raise ValueError("データが不足しています（最低50本必要）")

        strategies = get_all_strategies(config.indicators)
        total = len(strategies)

        await db.execute(
            update(Simulation)
            .where(Simulation.id == sim_id)
            .values(total_bars=len(df), total_strategies=total)
        )
        await db.commit()

        await progress(10, f"データ取得完了: {len(df)}本 / {total}ストラテジーをテスト中...")

        results_batch = []
        loop = asyncio.get_event_loop()

        for i, strategy in enumerate(strategies):
            pct = 10 + int((i / total) * 80)
            if i % 10 == 0:
                await progress(pct, f"({i}/{total}) {strategy.name} をテスト中...")

            # Run in thread pool to avoid blocking
            sig = await loop.run_in_executor(_executor, compute_signals, df, strategy)
            bt_result = await loop.run_in_executor(
                _executor, run_backtest, df, sig, config.trade_duration, False
            )

            results_batch.append(StrategyResult(
                sim_id=sim_id,
                strategy_name=strategy.name,
                indicator_family=strategy.family,
                parameters=json.dumps(strategy.params, ensure_ascii=False),
                total_trades=bt_result.total_trades,
                wins=bt_result.wins,
                losses=bt_result.losses,
                win_rate=bt_result.win_rate,
                profit_factor=bt_result.profit_factor,
                signal_bar_count=bt_result.signal_bar_count,
            ))

        await progress(90, "結果を保存中...")

        # Bulk insert results
        db.add_all(results_batch)
        await db.commit()

        # Assign ranks by win_rate DESC, then total_trades DESC
        from sqlalchemy import select, desc
        stmt = (
            select(StrategyResult)
            .where(StrategyResult.sim_id == sim_id)
            .order_by(desc(StrategyResult.win_rate), desc(StrategyResult.total_trades))
        )
        rows = (await db.execute(stmt)).scalars().all()
        for rank, row in enumerate(rows, start=1):
            row.rank = rank
        await db.commit()

        # Mark completed
        await db.execute(
            update(Simulation)
            .where(Simulation.id == sim_id)
            .values(status="COMPLETED", progress_pct=100,
                    completed_at=datetime.now(timezone.utc))
        )
        await db.commit()

        await progress(100, "シミュレーション完了！")
        if queue:
            queue.put_nowait({"type": "complete", "sim_id": sim_id})

    except Exception as e:
        logger.exception(f"Simulation {sim_id} failed: {e}")
        from sqlalchemy import update
        await db.execute(
            update(Simulation)
            .where(Simulation.id == sim_id)
            .values(status="FAILED", error_message=str(e))
        )
        await db.commit()
        if queue:
            try:
                queue.put_nowait({"type": "error", "message": str(e)})
            except asyncio.QueueFull:
                pass
    finally:
        # Don't remove the queue immediately; let WS drain it first
        pass
