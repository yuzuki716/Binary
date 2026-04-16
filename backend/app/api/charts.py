import json
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.models.orm import StrategyResult, Simulation
from app.models.schemas import ChartResponse, OHLCVBar, TradeRecord, IndicatorSeries
from app.services.data_fetcher import fetch_ohlcv
from app.services.indicator_engine import (
    StrategyConfig, compute_signals, compute_indicator_values
)
from app.services.backtest_engine import run_backtest

router = APIRouter(prefix="/charts", tags=["charts"])

INDICATOR_COLORS = {
    "fast_ma": "#f59e0b",
    "slow_ma": "#3b82f6",
    "upper": "#ef4444",
    "mid": "#6b7280",
    "lower": "#22c55e",
    "macd": "#3b82f6",
    "signal": "#f59e0b",
    "rsi": "#a855f7",
    "k": "#3b82f6",
    "d": "#f59e0b",
}

OSCILLATOR_KEYS = {"rsi", "macd", "signal", "histogram", "k", "d"}


@router.get("/{sim_id}/strategy/{strategy_id}", response_model=ChartResponse)
async def get_chart(
    sim_id: str,
    strategy_id: int,
    db: AsyncSession = Depends(get_db),
):
    # Load strategy result
    sr_result = await db.execute(
        select(StrategyResult).where(
            StrategyResult.id == strategy_id,
            StrategyResult.sim_id == sim_id
        )
    )
    sr = sr_result.scalar_one_or_none()
    if not sr:
        raise HTTPException(status_code=404, detail="ストラテジーが見つかりません")

    # Load simulation config
    sim_result = await db.execute(select(Simulation).where(Simulation.id == sim_id))
    sim = sim_result.scalar_one_or_none()
    if not sim:
        raise HTTPException(status_code=404, detail="シミュレーションが見つかりません")

    # Fetch OHLCV (uses cache)
    df = await fetch_ohlcv(sim.symbol, sim.timeframe, 2000)

    # Rebuild strategy config
    params = json.loads(sr.parameters)
    config = StrategyConfig(
        family=sr.indicator_family,
        name=sr.strategy_name,
        params=params
    )

    # Compute signals and run backtest with trade records
    signals = compute_signals(df, config)
    bt = run_backtest(df, signals, sim.trade_duration, with_trades=True)

    # Compute indicator values for chart overlay
    ind_values = compute_indicator_values(df, config)

    # Build OHLCV bars
    ohlcv_bars = [
        OHLCVBar(
            time=int(row["timestamp"]),
            open=float(row["open"]),
            high=float(row["high"]),
            low=float(row["low"]),
            close=float(row["close"]),
            volume=float(row["volume"]),
        )
        for _, row in df.iterrows()
    ]

    # Build indicator series
    indicator_series = []
    for key, series in ind_values.items():
        if series is None:
            continue
        pane = 1 if key in OSCILLATOR_KEYS else 0
        series_type = "histogram" if key == "histogram" else "line"
        color = INDICATOR_COLORS.get(key, "#ffffff")

        valid = series.dropna()
        data = [
            {"time": int(df.loc[idx, "timestamp"]), "value": round(float(val), 6)}
            for idx, val in valid.items()
        ]
        if key == "histogram":
            data = [
                {
                    "time": int(df.loc[idx, "timestamp"]),
                    "value": round(float(val), 6),
                    "color": "#22c55e" if float(val) >= 0 else "#ef4444"
                }
                for idx, val in valid.items()
            ]

        indicator_series.append(IndicatorSeries(
            name=key, color=color, pane=pane, series_type=series_type, data=data
        ))

    # Build trade records
    trade_records = [
        TradeRecord(
            entry_time=t.entry_time,
            entry_price=t.entry_price,
            exit_time=t.exit_time,
            exit_price=t.exit_price,
            direction=t.direction,
            outcome=t.outcome,
        )
        for t in bt.trades
    ]

    return ChartResponse(
        strategy_name=sr.strategy_name,
        win_rate=sr.win_rate,
        total_trades=sr.total_trades,
        wins=sr.wins,
        losses=sr.losses,
        ohlcv=ohlcv_bars,
        indicators=indicator_series,
        trades=trade_records,
    )
