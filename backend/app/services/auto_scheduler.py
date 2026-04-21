"""
Background scheduler: runs full category analysis every AUTO_INTERVAL_MINUTES.
On startup, triggers immediately so fresh results are always available.
"""
import asyncio
import logging
import time
import uuid

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.core.database import AsyncSessionLocal
from app.models.orm import AutoLatest

logger = logging.getLogger(__name__)

ALL_INDICATORS = ["SMA_CROSS", "EMA_CROSS", "RSI", "MACD", "BB", "STOCH", "RSI_MA", "MACD_BB"]
AUTO_BAR_LIMIT = 2000
AUTO_INTERVAL_MINUTES = 30

_scheduler: AsyncIOScheduler | None = None
_is_running = False


async def _run_auto_analysis() -> None:
    global _is_running
    if _is_running:
        logger.info("Auto-analysis already running, skipping this trigger")
        return

    _is_running = True
    logger.info("Auto-analysis started")

    try:
        # Lazy import to avoid circular dependency at module load time
        from app.api.batch import (
            CATEGORY_SYMBOLS, BATCH_TIMEFRAMES, CATEGORY_DURATIONS,
            _create_and_launch_sims,
        )

        now = int(time.time())
        next_run = now + AUTO_INTERVAL_MINUTES * 60

        for category in ["crypto", "forex"]:
            batch_id = str(uuid.uuid4())
            symbols = CATEGORY_SYMBOLS[category]
            durations = CATEGORY_DURATIONS.get(category, [1, 5])

            try:
                async with AsyncSessionLocal() as db:
                    await _create_and_launch_sims(
                        db, batch_id, symbols,
                        BATCH_TIMEFRAMES, durations,
                        ALL_INDICATORS, AUTO_BAR_LIMIT,
                    )

                    existing = await db.get(AutoLatest, category)
                    if existing:
                        existing.batch_id = batch_id
                        existing.created_at = now
                        existing.next_run_at = next_run
                    else:
                        db.add(AutoLatest(
                            category=category,
                            batch_id=batch_id,
                            created_at=now,
                            next_run_at=next_run,
                        ))
                    await db.commit()

                logger.info("Auto batch launched: category=%s batch_id=%s", category, batch_id)

            except Exception:
                logger.exception("Failed to create auto batch for category=%s", category)

            await asyncio.sleep(1)   # small gap between categories

    finally:
        _is_running = False
        logger.info("Auto-analysis batches launched")


async def start_scheduler() -> None:
    global _scheduler
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)

    _scheduler = AsyncIOScheduler(timezone="UTC")
    _scheduler.add_job(
        _run_auto_analysis,
        "interval",
        minutes=AUTO_INTERVAL_MINUTES,
        id="auto_analysis",
        replace_existing=True,
        misfire_grace_time=300,
    )
    _scheduler.start()
    logger.info("Scheduler started (interval=%d min)", AUTO_INTERVAL_MINUTES)
    # Fire immediately on startup so results are ready without waiting
    asyncio.ensure_future(_run_auto_analysis())


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)
        logger.info("Scheduler stopped")


def get_scheduler_status() -> dict:
    next_run: int | None = None
    if _scheduler:
        job = _scheduler.get_job("auto_analysis")
        if job and job.next_run_time:
            next_run = int(job.next_run_time.timestamp())
    return {"is_running": _is_running, "next_run_at": next_run}
