"""
Unified OHLCV data fetcher.
- yfinance for forex pairs, stocks, indices
- ccxt (Binance) for crypto pairs
"""
import asyncio
import logging
from collections import OrderedDict
from typing import Optional
from datetime import datetime, timezone

import pandas as pd
import numpy as np

logger = logging.getLogger(__name__)

# Symbol routing map
SYMBOL_MAP = {
    # Forex
    "EURUSD": {"ticker": "EURUSD=X", "source": "yfinance", "display": "EUR/USD", "category": "forex"},
    "USDJPY": {"ticker": "JPY=X",    "source": "yfinance", "display": "USD/JPY", "category": "forex"},
    "GBPUSD": {"ticker": "GBPUSD=X", "source": "yfinance", "display": "GBP/USD", "category": "forex"},
    "AUDUSD": {"ticker": "AUDUSD=X", "source": "yfinance", "display": "AUD/USD", "category": "forex"},
    "USDCHF": {"ticker": "CHF=X",    "source": "yfinance", "display": "USD/CHF", "category": "forex"},
    "USDCAD": {"ticker": "CAD=X",    "source": "yfinance", "display": "USD/CAD", "category": "forex"},
    "NZDUSD": {"ticker": "NZDUSD=X", "source": "yfinance", "display": "NZD/USD", "category": "forex"},
    "EURJPY": {"ticker": "EURJPY=X", "source": "yfinance", "display": "EUR/JPY", "category": "forex"},
    "GBPJPY": {"ticker": "GBPJPY=X", "source": "yfinance", "display": "GBP/JPY", "category": "forex"},
    # Crypto (yfinance to avoid geo-restrictions)
    "BTCUSDT": {"ticker": "BTC-USD", "source": "yfinance", "display": "BTC/USDT", "category": "crypto"},
    "ETHUSDT": {"ticker": "ETH-USD", "source": "yfinance", "display": "ETH/USDT", "category": "crypto"},
    "BNBUSDT": {"ticker": "BNB-USD", "source": "yfinance", "display": "BNB/USDT", "category": "crypto"},
    "SOLUSDT": {"ticker": "SOL-USD", "source": "yfinance", "display": "SOL/USDT", "category": "crypto"},
    "XRPUSDT": {"ticker": "XRP-USD", "source": "yfinance", "display": "XRP/USDT", "category": "crypto"},
    # Indices
    "SPX500":  {"ticker": "^GSPC",    "source": "yfinance", "display": "S&P 500",    "category": "indices"},
    "NDX100":  {"ticker": "^NDX",     "source": "yfinance", "display": "NASDAQ 100", "category": "indices"},
    "DJI":     {"ticker": "^DJI",     "source": "yfinance", "display": "Dow Jones",  "category": "indices"},
    "N225":    {"ticker": "^N225",    "source": "yfinance", "display": "日経 225",    "category": "indices"},
    "DAX":     {"ticker": "^GDAXI",   "source": "yfinance", "display": "DAX 40",     "category": "indices"},
}

# yfinance timeframe period/interval mapping
YF_TIMEFRAME_MAP = {
    "1m":  {"period": "7d",   "interval": "1m"},
    "5m":  {"period": "60d",  "interval": "5m"},
    "15m": {"period": "60d",  "interval": "15m"},
    "1h":  {"period": "730d", "interval": "1h"},
    "4h":  {"period": "730d", "interval": "1h"},  # will resample
    "1d":  {"period": "5y",   "interval": "1d"},
}

# ccxt timeframe mapping
CCXT_TIMEFRAME_MAP = {
    "1m": "1m", "5m": "5m", "15m": "15m",
    "1h": "1h", "4h": "4h", "1d": "1d",
}

# LRU cache for OHLCV data (max 20 entries)
_cache: OrderedDict = OrderedDict()
_cache_max = 20


def _cache_key(symbol: str, timeframe: str) -> str:
    return f"{symbol}:{timeframe}"


def _cache_get(symbol: str, timeframe: str) -> Optional[pd.DataFrame]:
    key = _cache_key(symbol, timeframe)
    if key in _cache:
        _cache.move_to_end(key)
        return _cache[key]
    return None


def _cache_set(symbol: str, timeframe: str, df: pd.DataFrame):
    key = _cache_key(symbol, timeframe)
    _cache[key] = df
    _cache.move_to_end(key)
    if len(_cache) > _cache_max:
        _cache.popitem(last=False)


def _fetch_yfinance(ticker: str, timeframe: str, limit: int) -> pd.DataFrame:
    import yfinance as yf

    tf_config = YF_TIMEFRAME_MAP.get(timeframe, {"period": "60d", "interval": "1h"})
    interval = tf_config["interval"]
    period = tf_config["period"]

    df = yf.download(ticker, period=period, interval=interval,
                     auto_adjust=True, progress=False, threads=False)

    if df.empty:
        raise ValueError(f"yfinance returned no data for {ticker}")

    # yfinance >= 0.2.x returns MultiIndex columns for single ticker
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)

    # Resample 1h to 4h if needed
    if timeframe == "4h" and interval == "1h":
        df = df.resample("4h").agg({
            "Open": "first", "High": "max", "Low": "min",
            "Close": "last", "Volume": "sum"
        }).dropna()

    df.index = df.index.tz_localize(None) if df.index.tz is not None else df.index
    df = df.rename(columns={"Open": "open", "High": "high", "Low": "low",
                             "Close": "close", "Volume": "volume"})
    df = df[["open", "high", "low", "close", "volume"]].dropna()
    df["timestamp"] = (df.index.astype(np.int64) // 10**9).astype(int)

    return df.tail(limit).reset_index(drop=True)


def _fetch_ccxt(ticker: str, timeframe: str, limit: int) -> pd.DataFrame:
    import ccxt

    exchange = ccxt.binance({"enableRateLimit": True})
    tf = CCXT_TIMEFRAME_MAP.get(timeframe, "1h")

    ohlcv = exchange.fetch_ohlcv(ticker, timeframe=tf, limit=min(limit, 1000))
    if not ohlcv:
        raise ValueError(f"ccxt returned no data for {ticker}")

    df = pd.DataFrame(ohlcv, columns=["timestamp_ms", "open", "high", "low", "close", "volume"])
    df["timestamp"] = (df["timestamp_ms"] // 1000).astype(int)
    df = df[["timestamp", "open", "high", "low", "close", "volume"]].dropna()

    # If we need more than 1000 bars, fetch more pages
    while len(df) < limit and len(ohlcv) == 1000:
        since = int(ohlcv[0][0]) - (1000 * _timeframe_ms(tf))
        ohlcv = exchange.fetch_ohlcv(ticker, timeframe=tf, limit=1000, since=since)
        if not ohlcv:
            break
        new_df = pd.DataFrame(ohlcv, columns=["timestamp_ms", "open", "high", "low", "close", "volume"])
        new_df["timestamp"] = (new_df["timestamp_ms"] // 1000).astype(int)
        new_df = new_df[["timestamp", "open", "high", "low", "close", "volume"]]
        df = pd.concat([new_df, df], ignore_index=True).drop_duplicates("timestamp").sort_values("timestamp")

    return df.tail(limit).reset_index(drop=True)


def _timeframe_ms(tf: str) -> int:
    mapping = {"1m": 60000, "5m": 300000, "15m": 900000,
               "1h": 3600000, "4h": 14400000, "1d": 86400000}
    return mapping.get(tf, 3600000)


async def fetch_ohlcv(symbol_key: str, timeframe: str, limit: int = 2000) -> pd.DataFrame:
    """Fetch OHLCV data. Returns DataFrame with columns: timestamp, open, high, low, close, volume"""
    cached = _cache_get(symbol_key, timeframe)
    if cached is not None and len(cached) >= limit:
        return cached.tail(limit).reset_index(drop=True)

    info = SYMBOL_MAP.get(symbol_key.upper())
    if not info:
        raise ValueError(f"Unknown symbol: {symbol_key}")

    loop = asyncio.get_event_loop()

    if info["source"] == "yfinance":
        df = await loop.run_in_executor(None, _fetch_yfinance, info["ticker"], timeframe, limit)
    else:
        df = await loop.run_in_executor(None, _fetch_ccxt, info["ticker"], timeframe, limit)

    _cache_set(symbol_key, timeframe, df)
    return df


def get_symbols():
    """Return categorized symbol list"""
    from app.models.schemas import SymbolInfo, SymbolsResponse
    result = {"forex": [], "crypto": [], "indices": []}
    for key, info in SYMBOL_MAP.items():
        cat = info["category"]
        result[cat].append(SymbolInfo(
            key=key,
            display=info["display"],
            source=info["source"],
            category=cat
        ))
    return SymbolsResponse(**result)
