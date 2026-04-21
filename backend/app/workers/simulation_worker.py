"""
Background simulation worker.
Each invocation creates its own DB session and respects a global concurrency semaphore.
"""
import asyncio
import json
import logging
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Optional

from app.models.schemas import SimulationCreate
from app.services.data_fetcher import get_max_bars

logger = logging.getLogger(__name__)

_progress_queues: dict = {}
_executor = ThreadPoolExecutor(max_workers=4)

# Max 3 simulations run concurrently to stay within Render free-tier limits
_semaphore: Optional[asyncio.Semaphore] = None

BARS_PER_HOUR = {"1m": 60, "5m": 12, "15m": 4, "1h": 1, "4h": 0.25, "1d": 1/24}


def _get_semaphore() -> asyncio.Semaphore:
    global _semaphore
    if _semaphore is None:
        _semaphore = asyncio.Semaphore(3)
    return _semaphore


def get_progress_queue(sim_id: str):
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
    from sqlalchemy import update, select, desc, func

    # Notify immediately before semaphore so the progress page doesn't show blank
    _pre_queue = get_progress_queue(sim_id)
    if _pre_queue:
        try:
            _pre_queue.put_nowait({"type": "progress", "percent": 0, "message": "分析スロット待機中..."})
        except asyncio.QueueFull:
            pass

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

                strategies = get_all_strategies(
                    config.indicators,
                    target_names=config.target_strategy_names,
                )
                total = len(strategies)
                total_bars = len(df)

                await db.execute(
                    update(Simulation).where(Simulation.id == sim_id)
                    .values(total_bars=total_bars, total_strategies=total)
                )
                await db.commit()

                await progress(10, f"データ取得完了: {total_bars}本 / {total}ストラテジーをテスト中...")

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

                    payout_rate = config.payout_rate
                    if payout_rate and payout_rate > 0 and bt_result.total_trades > 0:
                        # Real binary options EV: win_rate*payout - loss_rate*1
                        ev_per_trade = bt_result.win_rate * payout_rate - (1 - bt_result.win_rate)
                        ev = round(ev_per_trade * bt_result.total_trades, 4)
                    else:
                        pf = bt_result.profit_factor or 0.0
                        ev = round(pf * bt_result.total_trades, 4)

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
                        expected_value=ev,
                        timeframe=config.timeframe,
                        total_bars=total_bars,
                        signal_bar_count=bt_result.signal_bar_count,
                    ))

                await progress(90, "結果を保存中...")
                db.add_all(results_batch)
                await db.commit()

                # Rank by expected_value DESC (then total_trades as tiebreaker)
                rows = (await db.execute(
                    select(StrategyResult)
                    .where(StrategyResult.sim_id == sim_id)
                    .order_by(desc(StrategyResult.expected_value), desc(StrategyResult.total_trades))
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

                # Check if all sims in this batch are done → trigger refinement
                await _maybe_trigger_refinement(sim_id, config, db)

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


async def _maybe_trigger_refinement(sim_id: str, config: SimulationCreate, db):
    """After a sim completes, if it's part of a batch and was not itself a refinement,
    check if all batch sims are done. If so, trigger top-5 refinement with 100000 bars."""
    from app.core.database import AsyncSessionLocal
    from app.models.orm import Simulation, StrategyResult
    from sqlalchemy import update, select, func as sqlfunc

    if config.refinement_for:
        return  # This IS a refinement sim; don't recurse

    # Get batch_id for this sim
    sim_row = (await db.execute(select(Simulation).where(Simulation.id == sim_id))).scalar_one_or_none()
    if not sim_row or not sim_row.batch_id:
        return

    batch_id = sim_row.batch_id

    # Are there still pending/running sims in the batch?
    pending = (await db.execute(
        select(sqlfunc.count()).select_from(Simulation)
        .where(Simulation.batch_id == batch_id)
        .where(Simulation.status.in_(["PENDING", "RUNNING"]))
    )).scalar()
    if pending > 0:
        return

    # Has refinement already been triggered for this batch?
    already = (await db.execute(
        select(sqlfunc.count()).select_from(Simulation)
        .where(Simulation.batch_id == batch_id)
        .where(Simulation.refinement_batch_id.isnot(None))
    )).scalar()
    if already > 0:
        return

    logger.info(f"Batch {batch_id} complete — triggering top-5 refinement")
    asyncio.create_task(_run_batch_refinement(batch_id))


async def _run_batch_refinement(original_batch_id: str):
    """Find top-5 strategies by EV across the batch, re-run each with 100000 bars."""
    from app.core.database import AsyncSessionLocal
    from app.models.orm import Simulation, StrategyResult
    from sqlalchemy import update, select, desc

    async with AsyncSessionLocal() as db:
        # Find top-5 (strategy, sim) pairs by expected_value with min 5 trades
        rows = (await db.execute(
            select(StrategyResult, Simulation)
            .join(Simulation, StrategyResult.sim_id == Simulation.id)
            .where(Simulation.batch_id == original_batch_id)
            .where(Simulation.status == "COMPLETED")
            .where(StrategyResult.total_trades >= 5)
            .order_by(desc(StrategyResult.expected_value))
            .limit(5)
        )).all()

        if not rows:
            logger.warning(f"Refinement: no results found for batch {original_batch_id}")
            return

        refinement_batch_id = str(uuid.uuid4())

        # Mark original batch sims with refinement_batch_id
        await db.execute(
            update(Simulation).where(Simulation.batch_id == original_batch_id)
            .values(refinement_batch_id=refinement_batch_id)
        )

        # Create one refinement sim per top strategy
        sim_configs = []
        for result, sim in rows:
            sim_id = str(uuid.uuid4())
            ref_sim = Simulation(
                id=sim_id,
                symbol=sim.symbol,
                symbol_display=sim.symbol_display,
                timeframe=sim.timeframe,
                trade_duration=sim.trade_duration,
                indicators=json.dumps([result.indicator_family]),
                status="PENDING",
                progress_pct=0,
                batch_id=refinement_batch_id,
                refinement_for=original_batch_id,
                payout_rate=sim.payout_rate,
            )
            db.add(ref_sim)
            config = SimulationCreate(
                symbol=sim.symbol,
                symbol_display=sim.symbol_display,
                timeframe=sim.timeframe,
                trade_duration=sim.trade_duration,
                indicators=[result.indicator_family],
                bar_limit=get_max_bars(sim.symbol, sim.timeframe),
                payout_rate=sim.payout_rate,
                target_strategy_names=[result.strategy_name],
                refinement_for=original_batch_id,
            )
            sim_configs.append((sim_id, config))

        await db.commit()
        logger.info(f"Refinement batch {refinement_batch_id} created with {len(sim_configs)} sims")

    for sim_id, config in sim_configs:
        asyncio.create_task(run_simulation(sim_id, config))
