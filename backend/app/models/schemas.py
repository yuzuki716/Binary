from pydantic import BaseModel, Field
from typing import Optional, List, Any
from datetime import datetime


class SimulationCreate(BaseModel):
    symbol: str = Field(..., description="Symbol key e.g. EURUSD")
    symbol_display: str = Field(..., description="Display name e.g. EUR/USD")
    timeframe: str = Field(..., description="Timeframe: 1m,5m,15m,1h,4h,1d")
    trade_duration: int = Field(..., description="Trade duration in bars (1 or 5)")
    indicators: List[str] = Field(
        default=["SMA_CROSS", "EMA_CROSS", "RSI", "MACD", "BB", "STOCH", "RSI_MA", "MACD_BB"],
        description="Indicator families to test"
    )
    bar_limit: int = Field(default=2000, ge=100, le=5000)


class SimulationStatus(BaseModel):
    id: str
    symbol: str
    symbol_display: str
    timeframe: str
    trade_duration: int
    status: str
    progress_pct: int
    total_strategies: Optional[int]
    total_bars: Optional[int]
    error_message: Optional[str]
    created_at: Optional[datetime]
    completed_at: Optional[datetime]


class StrategyResultOut(BaseModel):
    id: int
    sim_id: str
    rank: Optional[int]
    strategy_name: str
    indicator_family: str
    parameters: str  # JSON string
    total_trades: int
    wins: int
    losses: int
    win_rate: float
    profit_factor: Optional[float]
    signal_bar_count: Optional[int]


class ResultsResponse(BaseModel):
    sim_id: str
    total: int
    filtered: int
    page: int
    page_size: int
    results: List[StrategyResultOut]


class OHLCVBar(BaseModel):
    time: int
    open: float
    high: float
    low: float
    close: float
    volume: float


class TradeRecord(BaseModel):
    entry_time: int
    entry_price: float
    exit_time: int
    exit_price: float
    direction: str   # "CALL" or "PUT"
    outcome: str     # "WIN" or "LOSS"


class IndicatorSeries(BaseModel):
    name: str
    color: str
    pane: int  # 0 = main chart, 1+ = separate panes
    series_type: str  # "line", "histogram"
    data: List[dict]


class ChartResponse(BaseModel):
    strategy_name: str
    win_rate: float
    total_trades: int
    wins: int
    losses: int
    ohlcv: List[OHLCVBar]
    indicators: List[IndicatorSeries]
    trades: List[TradeRecord]


class SymbolInfo(BaseModel):
    key: str
    display: str
    source: str
    category: str


class SymbolsResponse(BaseModel):
    forex: List[SymbolInfo]
    crypto: List[SymbolInfo]
    indices: List[SymbolInfo]
