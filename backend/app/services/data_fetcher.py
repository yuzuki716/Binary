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
    "USDCHF": {"ticker": "CHF=X",    "source": "yfinance", "display": "USD/CHF", "category": "forex"},
    "GBPJPY": {"ticker": "GBPJPY=X", "source": "yfinance", "display": "GBP/JPY", "category": "forex"},
    "AUDJPY": {"ticker": "AUDJPY=X", "source": "yfinance", "display": "AUD/JPY", "category": "forex"},
    "NZDJPY": {"ticker": "NZDJPY=X", "source": "yfinance", "display": "NZD/JPY", "category": "forex"},
    "EURGBP": {"ticker": "EURGBP=X", "source": "yfinance", "display": "EUR/GBP", "category": "forex"},
    "AUDNZD": {"ticker": "AUDNZD=X", "source": "yfinance", "display": "AUD/NZD", "category": "forex"},
    "GBPCHF": {"ticker": "GBPCHF=X", "source": "yfinance", "display": "GBP/CHF", "category": "forex"},
    "EURCAD": {"ticker": "EURCAD=X", "source": "yfinance", "display": "EUR/CAD", "category": "forex"},
    "USDCNH": {"ticker": "USDCNH=X", "source": "yfinance", "display": "USD/CNH", "category": "forex"},
    # Crypto (Binance.US - works from US-based servers like Render)
    "BTCUSDT":  {"ticker": "BTC/USDT",  "source": "ccxt", "display": "Bitcoin",  "category": "crypto"},
    "DOGEUSDT": {"ticker": "DOGE/USDT", "source": "ccxt", "display": "Dogecoin", "category": "crypto"},
    "SOLUSDT":  {"ticker": "SOL/USDT",  "source": "ccxt", "display": "Solana",   "category": "crypto"},
    "BNBUSDT":  {"ticker": "BNB/USDT",  "source": "ccxt", "display": "BNB",      "category": "crypto"},
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

# Max bars realistically available per data source and timeframe
_MAX_BARS: dict = {
    "yfinance": {
        "1m": 10000, "5m": 15000, "15m": 5500,
        "1h": 17000, "4h": 4000,  "1d": 1800,
    },
    "ccxt": {
        "1m": 10000, "5m": 12000, "15m": 12000,
        "1h": 10000, "4h": 5000,  "1d": 3000,
    },
}


def get_max_bars(symbol_key: str, timeframe: str) -> int:
    info = SYMBOL_MAP.get(symbol_key.upper())
    if not info:
        return 2000
    return _MAX_BARS.get(info["source"], {}).get(timeframe, 2000)


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
    import requests

    tf_config = YF_TIMEFRAME_MAP.get(timeframe, {"period": "60d", "interval": "1h"})
    interval = tf_config["interval"]
    period = tf_config["period"]

    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json",
    }
    params = {"interval": interval, "range": period}

    resp = requests.get(url, headers=headers, params=params, timeout=30)
    resp.raise_for_status()
    data = resp.json()

    result = data.get("chart", {}).get("result")
    if not result:
        err = data.get("chart", {}).get("error", {})
        raise ValueError(f"Yahoo Finance returned no data for {ticker}: {err}")

    r = result[0]
    timestamps = r["timestamp"]
    q = r["indicators"]["quote"][0]
    adj = r["indicators"].get("adjclose", [{}])[0]
    closes = adj.get("adjclose") or q["close"]

    df = pd.DataFrame({
        "timestamp": timestamps,
        "open":   q["open"],
        "high":   q["high"],
        "low":    q["low"],
        "close":  closes,
        "volume": q.get("volume") or [0] * len(timestamps),
    }).dropna(subset=["close"])

    if df.empty:
        raise ValueError(f"Yahoo Finance returned no data for {ticker}")

    # Resample 1h to 4h if needed
    if timeframe == "4h":
        df["dt"] = pd.to_datetime(df["timestamp"], unit="s")
        df = df.set_index("dt").resample("4h").agg({
            "timestamp": "first", "open": "first", "high": "max",
            "low": "min", "close": "last", "volume": "sum"
        }).dropna(subset=["close"]).reset_index(drop=True)

    return df[["timestamp", "open", "high", "low", "close", "volume"]].tail(limit).reset_index(drop=True)


def _fetch_ccxt(ticker: str, timeframe: str, limit: int) -> pd.DataFrame:
    import ccxt

    exchange = ccxt.binanceus({"enableRateLimit": True})
    tf = CCXT_TIMEFRAME_MAP.get(timeframe, "1h")

    ohlcv = exchange.fetch_ohlcv(ticker, timeframe=tf, limit=min(limit, 1000))
    if not ohlcv:
        raise ValueError(f"ccxt returned no data for {ticker}")

    df = pd.DataFrame(ohlcv, columns=["timestamp_ms", "open", "high", "low", "close", "volume"])
    df["timestamp"] = (df["timestamp_ms"] // 1000).astype(int)
    df = df[["timestamp", "open", "high", "low", "close", "volume"]].dropna()

    # Fetch more pages going backwards in time (max 12 extra pages = 13,000 bars total)
    pages = 0
    while len(df) < limit and len(ohlcv) == 1000 and pages < 12:
        pages += 1
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


# Twelve Data symbol mapping (forex real-time monitoring)
_TD_SYMBOL_MAP = {
    "EURUSD": "EUR/USD", "USDJPY": "USD/JPY", "GBPUSD": "GBP/USD",
    "USDCHF": "USD/CHF", "GBPJPY": "GBP/JPY", "AUDJPY": "AUD/JPY",
    "NZDJPY": "NZD/JPY", "EURGBP": "EUR/GBP", "AUDNZD": "AUD/NZD",
    "GBPCHF": "GBP/CHF", "EURCAD": "EUR/CAD", "USDCNH": "USD/CNH",
}
_TD_TF_MAP = {"1m": "1min", "5m": "5min", "15m": "15min", "1h": "1h"}


def _fetch_twelvedata(symbol_key: str, timeframe: str, limit: int) -> pd.DataFrame:
    import requests
    from app.core.config import settings

    api_key = settings.twelve_data_api_key
    if not api_key:
        raise ValueError("TWELVE_DATA_API_KEY is not configured")

    td_symbol = _TD_SYMBOL_MAP.get(symbol_key.upper())
    if not td_symbol:
        raise ValueError(f"Symbol {symbol_key} not mapped for Twelve Data")

    interval = _TD_TF_MAP.get(timeframe)
    if not interval:
        raise ValueError(f"Timeframe {timeframe} not supported by Twelve Data")

    resp = requests.get(
        "https://api.twelvedata.com/time_series",
        params={
            "symbol": td_symbol,
            "interval": interval,
            "outputsize": min(limit, 5000),
            "apikey": api_key,
            "order": "ASC",
        },
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()

    if data.get("status") == "error":
        raise ValueError(f"Twelve Data error: {data.get('message', 'unknown')}")

    values = data.get("values", [])
    if not values:
        raise ValueError(f"Twelve Data returned no data for {td_symbol} {timeframe}")

    df = pd.DataFrame(values)
    df["timestamp"] = (pd.to_datetime(df["datetime"]).astype("int64") // 10**9).astype(int)
    for col in ["open", "high", "low", "close"]:
        df[col] = pd.to_numeric(df[col], errors="coerce")
    df["volume"] = pd.to_numeric(df.get("volume", 0), errors="coerce").fillna(0)

    return df[["timestamp", "open", "high", "low", "close", "volume"]].tail(limit).reset_index(drop=True)


async def fetch_ohlcv_realtime(symbol_key: str, timeframe: str, limit: int = 200) -> pd.DataFrame:
    """Fetch fresh OHLCV for real-time signal monitoring.
    Forex → Twelve Data (real-time, no delay).
    Crypto → Binance via ccxt (unchanged).
    """
    info = SYMBOL_MAP.get(symbol_key.upper())
    if not info:
        raise ValueError(f"Unknown symbol: {symbol_key}")

    loop = asyncio.get_event_loop()

    if info["source"] == "yfinance":
        return await asyncio.wait_for(
            loop.run_in_executor(None, _fetch_twelvedata, symbol_key, timeframe, limit),
            timeout=30,
        )
    else:
        return await asyncio.wait_for(
            loop.run_in_executor(None, _fetch_ccxt, info["ticker"], timeframe, limit),
            timeout=30,
        )


async def fetch_ohlcv(symbol_key: str, timeframe: str, limit: int = 2000, fresh: bool = False) -> pd.DataFrame:
    """Fetch OHLCV data. Returns DataFrame with columns: timestamp, open, high, low, close, volume.
    fresh=True bypasses cache (used by the real-time signal monitor).
    """
    if not fresh:
        cached = _cache_get(symbol_key, timeframe)
        if cached is not None and len(cached) >= limit:
            return cached.tail(limit).reset_index(drop=True)

    info = SYMBOL_MAP.get(symbol_key.upper())
    if not info:
        raise ValueError(f"Unknown symbol: {symbol_key}")

    loop = asyncio.get_event_loop()

    if info["source"] == "yfinance":
        df = await asyncio.wait_for(
            loop.run_in_executor(None, _fetch_yfinance, info["ticker"], timeframe, limit),
            timeout=90,
        )
    else:
        df = await asyncio.wait_for(
            loop.run_in_executor(None, _fetch_ccxt, info["ticker"], timeframe, limit),
            timeout=90,
        )

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
