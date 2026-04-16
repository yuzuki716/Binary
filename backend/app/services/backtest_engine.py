"""
Vectorized binary options backtesting engine.
Uses numpy operations for performance.

Win condition:
  CALL (signal=1): close[entry + duration] > close[entry]
  PUT  (signal=-1): close[entry + duration] < close[entry]
"""
import logging
from dataclasses import dataclass, field
from typing import List, Optional

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)


@dataclass
class TradeRecord:
    entry_idx: int
    entry_time: int
    entry_price: float
    exit_idx: int
    exit_time: int
    exit_price: float
    direction: str   # "CALL" or "PUT"
    outcome: str     # "WIN" or "LOSS"


@dataclass
class BacktestResult:
    total_trades: int = 0
    wins: int = 0
    losses: int = 0
    win_rate: float = 0.0
    profit_factor: Optional[float] = None
    signal_bar_count: int = 0
    trades: List[TradeRecord] = field(default_factory=list)


def run_backtest(
    df: pd.DataFrame,
    signals: pd.Series,
    trade_duration: int,
    with_trades: bool = False
) -> BacktestResult:
    """
    Run binary options backtest.

    Args:
        df: OHLCV DataFrame with 'close', 'timestamp' columns
        signals: Series of {1=CALL, -1=PUT, 0=no signal}
        trade_duration: Number of bars until expiry
        with_trades: Whether to collect individual trade records

    Returns:
        BacktestResult
    """
    close = df["close"].values
    timestamps = df["timestamp"].values if "timestamp" in df.columns else np.arange(len(df))
    sig = signals.values.astype(int)
    n = len(close)

    result = BacktestResult()
    result.signal_bar_count = int(np.count_nonzero(sig))

    if result.signal_bar_count == 0 or trade_duration >= n:
        return result

    # Resolve non-overlapping trades
    # Track when next trade can be entered
    entry_indices = []
    directions = []
    next_free = 0

    for i in range(n - trade_duration):
        if i < next_free:
            continue
        if sig[i] != 0:
            entry_indices.append(i)
            directions.append(sig[i])
            next_free = i + trade_duration + 1

    if not entry_indices:
        return result

    entry_arr = np.array(entry_indices, dtype=int)
    dir_arr = np.array(directions, dtype=int)
    exit_arr = entry_arr + trade_duration

    # Clamp exits to valid range
    valid = exit_arr < n
    entry_arr = entry_arr[valid]
    dir_arr = dir_arr[valid]
    exit_arr = exit_arr[valid]

    if len(entry_arr) == 0:
        return result

    entry_prices = close[entry_arr]
    exit_prices = close[exit_arr]
    price_diff = exit_prices - entry_prices

    win_mask = ((dir_arr == 1) & (price_diff > 0)) | ((dir_arr == -1) & (price_diff < 0))

    result.total_trades = int(len(entry_arr))
    result.wins = int(np.sum(win_mask))
    result.losses = result.total_trades - result.wins
    result.win_rate = result.wins / result.total_trades if result.total_trades > 0 else 0.0
    result.profit_factor = (result.wins / result.losses) if result.losses > 0 else None

    if with_trades:
        for i in range(len(entry_arr)):
            ei = entry_arr[i]
            xi = exit_arr[i]
            result.trades.append(TradeRecord(
                entry_idx=int(ei),
                entry_time=int(timestamps[ei]),
                entry_price=float(entry_prices[i]),
                exit_idx=int(xi),
                exit_time=int(timestamps[xi]),
                exit_price=float(exit_prices[i]),
                direction="CALL" if dir_arr[i] == 1 else "PUT",
                outcome="WIN" if win_mask[i] else "LOSS"
            ))

    return result
