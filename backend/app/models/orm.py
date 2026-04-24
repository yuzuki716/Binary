from sqlalchemy import Column, Integer, String, Float, DateTime, Text
from sqlalchemy.sql import func
from app.core.database import Base


class AutoLatest(Base):
    """Stores the most recent auto-analysis batch ID per category."""
    __tablename__ = "auto_latest"

    category = Column(String, primary_key=True)   # crypto / forex / indices
    batch_id = Column(String, nullable=False)
    created_at = Column(Integer, nullable=False)   # Unix timestamp
    next_run_at = Column(Integer, nullable=True)   # Unix timestamp


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
    batch_id = Column(String, nullable=True, index=True)
    refinement_batch_id = Column(String, nullable=True)
    refinement_for = Column(String, nullable=True)
    payout_rate = Column(Float, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    completed_at = Column(DateTime, nullable=True)


class SignalAlert(Base):
    """Records real-time signals sent to Discord to prevent duplicate notifications."""
    __tablename__ = "signal_alerts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    symbol_display = Column(String, nullable=False, index=True)
    timeframe = Column(String, nullable=False)
    trade_duration = Column(Integer, nullable=False)
    strategy_name = Column(String, nullable=False)
    signal = Column(String, nullable=False)   # "CALL" or "PUT"
    bar_timestamp = Column(Integer, nullable=False)   # Unix timestamp of the signaling bar
    sent_at = Column(DateTime, server_default=func.now())


class SymbolPayoutRate(Base):
    """Stores user-entered payout rate (%) per symbol_display."""
    __tablename__ = "symbol_payout_rates"

    symbol_display = Column(String, primary_key=True)   # e.g. "BTC/USDT"
    payout_pct = Column(Integer, nullable=False)         # e.g. 80 → 80%
    updated_at = Column(DateTime, server_default=func.now())


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
    expected_value = Column(Float, nullable=True)   # profit_factor * total_trades
    timeframe = Column(String, nullable=True)        # copied from sim for hourly_ev
    total_bars = Column(Integer, nullable=True)      # copied from sim for hourly_ev
    signal_bar_count = Column(Integer, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
