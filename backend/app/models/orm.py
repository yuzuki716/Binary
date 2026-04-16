from sqlalchemy import Column, Integer, String, Float, DateTime, Text
from sqlalchemy.sql import func
from app.core.database import Base


class Simulation(Base):
    __tablename__ = "simulations"

    id = Column(String, primary_key=True)
    symbol = Column(String, nullable=False)
    symbol_display = Column(String, nullable=False)
    timeframe = Column(String, nullable=False)
    trade_duration = Column(Integer, nullable=False)
    indicators = Column(Text, nullable=False)  # JSON
    status = Column(String, nullable=False, default="PENDING")
    error_message = Column(Text, nullable=True)
    total_bars = Column(Integer, nullable=True)
    total_strategies = Column(Integer, nullable=True)
    progress_pct = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, server_default=func.now())
    completed_at = Column(DateTime, nullable=True)


class StrategyResult(Base):
    __tablename__ = "strategy_results"

    id = Column(Integer, primary_key=True, autoincrement=True)
    sim_id = Column(String, nullable=False, index=True)
    rank = Column(Integer, nullable=True)
    strategy_name = Column(String, nullable=False)
    indicator_family = Column(String, nullable=False)
    parameters = Column(Text, nullable=False)  # JSON
    total_trades = Column(Integer, nullable=False)
    wins = Column(Integer, nullable=False)
    losses = Column(Integer, nullable=False)
    win_rate = Column(Float, nullable=False)
    profit_factor = Column(Float, nullable=True)
    signal_bar_count = Column(Integer, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
