from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import text
from app.core.config import settings
import os

os.makedirs(os.path.dirname(settings.database_url.replace("sqlite+aiosqlite:///", "")), exist_ok=True)

engine = create_async_engine(settings.database_url, echo=False)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def init_db():
    from app.models.orm import Simulation, StrategyResult, AutoLatest  # noqa: F401
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # Migrations: add new columns if missing
        for stmt in [
            "ALTER TABLE simulations ADD COLUMN batch_id TEXT",
            "ALTER TABLE simulations ADD COLUMN refinement_batch_id TEXT",
            "ALTER TABLE simulations ADD COLUMN refinement_for TEXT",
            "ALTER TABLE strategy_results ADD COLUMN expected_value REAL",
            "ALTER TABLE strategy_results ADD COLUMN timeframe TEXT",
            "ALTER TABLE strategy_results ADD COLUMN total_bars INTEGER",
            "ALTER TABLE simulations ADD COLUMN payout_rate REAL",
        ]:
            try:
                await conn.execute(text(stmt))
            except Exception:
                pass


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
