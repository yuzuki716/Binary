"""
Technical indicator engine using pure pandas/numpy.
Computes signals {1=CALL, -1=PUT, 0=no signal} for each strategy.
"""
import itertools
import logging
from dataclasses import dataclass, field
from typing import Dict, List, Any

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)


@dataclass
class StrategyConfig:
    family: str
    name: str
    params: Dict[str, Any]


def _sma(series: pd.Series, period: int) -> pd.Series:
    return series.rolling(window=period, min_periods=period).mean()


def _ema(series: pd.Series, period: int) -> pd.Series:
    return series.ewm(span=period, adjust=False, min_periods=period).mean()


def _rsi(series: pd.Series, period: int) -> pd.Series:
    delta = series.diff()
    gain = delta.clip(lower=0).rolling(window=period, min_periods=period).mean()
    loss = (-delta.clip(upper=0)).rolling(window=period, min_periods=period).mean()
    rs = gain / loss.replace(0, np.nan)
    return 100 - (100 / (1 + rs))


def _macd(series: pd.Series, fast: int, slow: int, signal: int):
    ema_fast = _ema(series, fast)
    ema_slow = _ema(series, slow)
    macd_line = ema_fast - ema_slow
    signal_line = _ema(macd_line, signal)
    histogram = macd_line - signal_line
    return macd_line, signal_line, histogram


def _bollinger(series: pd.Series, period: int, std_mult: float):
    mid = _sma(series, period)
    std = series.rolling(window=period, min_periods=period).std()
    upper = mid + std_mult * std
    lower = mid - std_mult * std
    return upper, mid, lower


def _stochastic(high: pd.Series, low: pd.Series, close: pd.Series, k_period: int, d_period: int):
    lowest_low = low.rolling(window=k_period, min_periods=k_period).min()
    highest_high = high.rolling(window=k_period, min_periods=k_period).max()
    denom = highest_high - lowest_low
    denom = denom.replace(0, np.nan)
    k = 100 * (close - lowest_low) / denom
    d = k.rolling(window=d_period, min_periods=d_period).mean()
    return k, d


def _crossover(a: pd.Series, b: pd.Series) -> pd.Series:
    """Returns 1 where a crosses above b, -1 where a crosses below b"""
    cross = pd.Series(0, index=a.index, dtype=int)
    prev_above = (a.shift(1) > b.shift(1))
    curr_above = (a > b)
    cross[~prev_above & curr_above] = 1   # crossed above (bullish)
    cross[prev_above & ~curr_above] = -1  # crossed below (bearish)
    return cross


# ─── Strategy parameter grids ───────────────────────────────────────────────

def _sma_cross_configs() -> List[StrategyConfig]:
    configs = []
    fast_list = [5, 8, 13, 20]
    slow_list = [20, 34, 55, 100]
    for fast, slow in itertools.product(fast_list, slow_list):
        if fast >= slow:
            continue
        configs.append(StrategyConfig(
            family="SMA_CROSS",
            name=f"SMA({fast}/{slow}) クロス",
            params={"fast": fast, "slow": slow}
        ))
    return configs


def _ema_cross_configs() -> List[StrategyConfig]:
    configs = []
    fast_list = [5, 8, 12, 21]
    slow_list = [21, 34, 55, 200]
    for fast, slow in itertools.product(fast_list, slow_list):
        if fast >= slow:
            continue
        configs.append(StrategyConfig(
            family="EMA_CROSS",
            name=f"EMA({fast}/{slow}) クロス",
            params={"fast": fast, "slow": slow}
        ))
    return configs


def _rsi_configs() -> List[StrategyConfig]:
    configs = []
    for period in [7, 9, 14, 21]:
        for ob, os_ in [(70, 30), (75, 25), (80, 20), (65, 35)]:
            configs.append(StrategyConfig(
                family="RSI",
                name=f"RSI({period}) ob={ob} os={os_}",
                params={"period": period, "overbought": ob, "oversold": os_}
            ))
    return configs


def _macd_configs() -> List[StrategyConfig]:
    configs = []
    for fast, slow, signal in itertools.product([8, 12], [21, 26], [7, 9]):
        if fast >= slow:
            continue
        configs.append(StrategyConfig(
            family="MACD",
            name=f"MACD({fast},{slow},{signal})",
            params={"fast": fast, "slow": slow, "signal": signal}
        ))
    return configs


def _bb_configs() -> List[StrategyConfig]:
    configs = []
    for period, std in itertools.product([10, 15, 20], [1.5, 2.0, 2.5]):
        configs.append(StrategyConfig(
            family="BB",
            name=f"BB({period},{std}) リバーサル",
            params={"period": period, "std": std}
        ))
    return configs


def _stoch_configs() -> List[StrategyConfig]:
    configs = []
    for k, d in itertools.product([5, 9, 14], [3, 5]):
        configs.append(StrategyConfig(
            family="STOCH",
            name=f"Stoch(%K={k},%D={d})",
            params={"k_period": k, "d_period": d, "overbought": 80, "oversold": 20}
        ))
    return configs


def _rsi_ma_configs() -> List[StrategyConfig]:
    configs = []
    for rsi_p, ma_fast, ma_slow in itertools.product([14], [8, 12], [21, 26]):
        if ma_fast >= ma_slow:
            continue
        configs.append(StrategyConfig(
            family="RSI_MA",
            name=f"RSI({rsi_p})+EMA({ma_fast}/{ma_slow})",
            params={"rsi_period": rsi_p, "ma_fast": ma_fast, "ma_slow": ma_slow,
                    "overbought": 70, "oversold": 30}
        ))
    return configs


def _macd_bb_configs() -> List[StrategyConfig]:
    configs = []
    for bb_std in [1.5, 2.0, 2.5]:
        configs.append(StrategyConfig(
            family="MACD_BB",
            name=f"MACD(12,26,9)+BB(20,{bb_std})",
            params={"macd_fast": 12, "macd_slow": 26, "macd_signal": 9,
                    "bb_period": 20, "bb_std": bb_std}
        ))
    return configs


FAMILY_CONFIGS = {
    "SMA_CROSS": _sma_cross_configs,
    "EMA_CROSS": _ema_cross_configs,
    "RSI": _rsi_configs,
    "MACD": _macd_configs,
    "BB": _bb_configs,
    "STOCH": _stoch_configs,
    "RSI_MA": _rsi_ma_configs,
    "MACD_BB": _macd_bb_configs,
}

ALL_FAMILIES = list(FAMILY_CONFIGS.keys())


def get_all_strategies(families: List[str] = None, target_names: List[str] = None) -> List[StrategyConfig]:
    if families is None:
        families = ALL_FAMILIES
    result = []
    for fam in families:
        gen_fn = FAMILY_CONFIGS.get(fam)
        if gen_fn:
            result.extend(gen_fn())
    if target_names:
        target_set = set(target_names)
        result = [s for s in result if s.name in target_set]
    return result


# ─── Signal computation ─────────────────────────────────────────────────────

def compute_signals(df: pd.DataFrame, config: StrategyConfig) -> pd.Series:
    """Returns Series with values {1=CALL, -1=PUT, 0=no signal}"""
    close = df["close"]
    high = df["high"]
    low = df["low"]
    n = len(df)

    try:
        fam = config.family
        p = config.params

        if fam == "SMA_CROSS":
            fast_ma = _sma(close, p["fast"])
            slow_ma = _sma(close, p["slow"])
            return _crossover(fast_ma, slow_ma)

        elif fam == "EMA_CROSS":
            fast_ma = _ema(close, p["fast"])
            slow_ma = _ema(close, p["slow"])
            return _crossover(fast_ma, slow_ma)

        elif fam == "RSI":
            rsi = _rsi(close, p["period"])
            signals = pd.Series(0, index=df.index, dtype=int)
            # CALL when RSI crosses back above oversold level
            signals[(rsi.shift(1) < p["oversold"]) & (rsi >= p["oversold"])] = 1
            # PUT when RSI crosses back below overbought level
            signals[(rsi.shift(1) > p["overbought"]) & (rsi <= p["overbought"])] = -1
            return signals

        elif fam == "MACD":
            macd_line, signal_line, _ = _macd(close, p["fast"], p["slow"], p["signal"])
            return _crossover(macd_line, signal_line)

        elif fam == "BB":
            upper, mid, lower = _bollinger(close, p["period"], p["std"])
            signals = pd.Series(0, index=df.index, dtype=int)
            # CALL when close crosses back above lower band
            signals[(close.shift(1) < lower.shift(1)) & (close >= lower)] = 1
            # PUT when close crosses back below upper band
            signals[(close.shift(1) > upper.shift(1)) & (close <= upper)] = -1
            return signals

        elif fam == "STOCH":
            k, d = _stochastic(high, low, close, p["k_period"], p["d_period"])
            signals = pd.Series(0, index=df.index, dtype=int)
            # CALL: %K crosses above %D in oversold zone
            k_cross_above = (k.shift(1) < d.shift(1)) & (k > d)
            signals[k_cross_above & (d < p["oversold"])] = 1
            # PUT: %K crosses below %D in overbought zone
            k_cross_below = (k.shift(1) > d.shift(1)) & (k < d)
            signals[k_cross_below & (d > p["overbought"])] = -1
            return signals

        elif fam == "RSI_MA":
            rsi = _rsi(close, p["rsi_period"])
            fast_ma = _ema(close, p["ma_fast"])
            slow_ma = _ema(close, p["ma_slow"])
            ma_cross = _crossover(fast_ma, slow_ma)
            signals = pd.Series(0, index=df.index, dtype=int)
            # CALL: MA bullish crossover AND RSI not overbought
            signals[(ma_cross == 1) & (rsi < p["overbought"])] = 1
            # PUT: MA bearish crossover AND RSI not oversold
            signals[(ma_cross == -1) & (rsi > p["oversold"])] = -1
            return signals

        elif fam == "MACD_BB":
            macd_line, signal_line, _ = _macd(close, p["macd_fast"], p["macd_slow"], p["macd_signal"])
            upper, mid, lower = _bollinger(close, p["bb_period"], p["bb_std"])
            macd_cross = _crossover(macd_line, signal_line)
            signals = pd.Series(0, index=df.index, dtype=int)
            # CALL: MACD bullish AND price near/below lower BB
            signals[(macd_cross == 1) & (close <= mid)] = 1
            # PUT: MACD bearish AND price near/above upper BB
            signals[(macd_cross == -1) & (close >= mid)] = -1
            return signals

    except Exception as e:
        logger.warning(f"Signal computation failed for {config.name}: {e}")

    return pd.Series(0, index=df.index, dtype=int)


def compute_indicator_values(df: pd.DataFrame, config: StrategyConfig) -> dict:
    """Returns raw indicator line values for chart rendering"""
    close = df["close"]
    high = df["high"]
    low = df["low"]
    p = config.params
    fam = config.family
    result = {}

    try:
        if fam in ("SMA_CROSS",):
            result["fast_ma"] = _sma(close, p["fast"])
            result["slow_ma"] = _sma(close, p["slow"])

        elif fam in ("EMA_CROSS", "RSI_MA"):
            result["fast_ma"] = _ema(close, p.get("ma_fast", p.get("fast")))
            result["slow_ma"] = _ema(close, p.get("ma_slow", p.get("slow")))
            if fam == "RSI_MA":
                result["rsi"] = _rsi(close, p["rsi_period"])

        elif fam == "RSI":
            result["rsi"] = _rsi(close, p["period"])

        elif fam == "MACD":
            macd_line, signal_line, histogram = _macd(close, p["fast"], p["slow"], p["signal"])
            result["macd"] = macd_line
            result["signal"] = signal_line
            result["histogram"] = histogram

        elif fam == "BB":
            upper, mid, lower = _bollinger(close, p["period"], p["std"])
            result["upper"] = upper
            result["mid"] = mid
            result["lower"] = lower

        elif fam == "STOCH":
            k, d = _stochastic(high, low, close, p["k_period"], p["d_period"])
            result["k"] = k
            result["d"] = d

        elif fam == "MACD_BB":
            macd_line, signal_line, histogram = _macd(close, p["macd_fast"], p["macd_slow"], p["macd_signal"])
            upper, mid, lower = _bollinger(close, p["bb_period"], p["bb_std"])
            result["macd"] = macd_line
            result["signal"] = signal_line
            result["histogram"] = histogram
            result["upper"] = upper
            result["mid"] = mid
            result["lower"] = lower

    except Exception as e:
        logger.warning(f"Indicator value computation failed for {config.name}: {e}")

    return result
