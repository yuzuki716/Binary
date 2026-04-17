"""
Background simulation worker.
Each invocation creates its own DB session and respects a global concurrency semaphore.
"""
import asyncio
import json
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Dict, Optional

from app.models.schemas import SimulationCreate

logger = logging.getLogger(__name__)

_progress_queues: Dict[str, asyncio.Queue] = {}
_executor = ThreadPoolExecutor(max_workers=4)

# Max 3 simulations run concurrently to stay within Render free-tier limits
_semaphore: Optional[asyncio.Semaphore] = None


def _get_semaphore() -> asyncio.Semaphore:
    global _semaphore
    if _semaphore is None:
        _semaphore = asyncio.Semaphore(3)
    return _semaphore


def get_progress_queue(sim_id: str) -> Optional[asyncio.Queue]:
    return _progress_queues.get(sim_id)


def create_progress_queue(sim_id: str) -> asyncio.Queue:
    q = asyncio.Queue(maxsize=200)
    _progress_queues[sim_id] = q
    return q


def remove_progress_queue(sim_id: str):
    _progress_queues.pop(sim_id, None)


async def run_simulation(sim_id: str, config: SimulationCreate):
    """Main simulation coroutine. Creates its own DB session and waits for a semaphore slot."""
    from app.core.database import AsyncSessionLocal
    from app.models.orm import Simulation, StrategyResult
    from app.services.data_fetcher import fetch_ohlcv
    from app.services.indicator_engine import get_all_strategies, compute_signals
    from app.services.backtest_engine import run_backtest
    from sqlalchemy import update, select, desc

    async with _get_semaphore():
        async with AsyncSessionLocal() as db:
            queue = get_progress_queue(sim_id)

            async def progress(pct: int, msg: str):
                if queue:
                    try:
                        queue.put_nowait({"type": "progress", "percent": pct, "message": msg})
                    except asyncio.QueueFull:
                        pass
                await db.execute(
                    update(Simulation).where(Simulation.id == sim_id).values(progress_pct=pct)
                )
                await db.commit()

            try:
                await db.execute(
                    update(Simulation).where(Simulation.id == sim_id)
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
                    update(Simulation).where(Simulation.id == sim_id)
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
                db.add_all(results_batch)
                await db.commit()

                rows = (await db.execute(
                    select(StrategyResult)
                    .where(StrategyResult.sim_id == sim_id)
                    .order_by(desc(StrategyResult.win_rate), desc(StrategyResult.total_trades))
                )).scalars().all()
                for rank, row in enumerate(rows, start=1):
                    row.rank = rank
                await db.commit()

                await db.execute(
                    update(Simulation).where(Simulation.id == sim_id)
                    .values(status="COMPLETED", progress_pct=100,
                            completed_at=datetime.now(timezone.utc))
                )
                await db.commit()

                await progress(100, "シミュレーション完了！")
                if queue:
                    queue.put_nowait({"type": "complete", "sim_id": sim_id})

            except Exception as e:
                logger.exception(f"Simulation {sim_id} failed: {e}")
                await db.execute(
                    update(Simulation).where(Simulation.id == sim_id)
                    .values(status="FAILED", error_message=str(e))
                )
                await db.commit()
                if queue:
                    try:
                        queue.put_nowait({"type": "error", "message": str(e)})
                    except asyncio.QueueFull:
                        pass
