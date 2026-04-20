export interface SymbolInfo {
  key: string
  display: string
  source: string
  category: string
}

export interface SymbolsResponse {
  forex: SymbolInfo[]
  crypto: SymbolInfo[]
  indices: SymbolInfo[]
}

export interface SimulationCreate {
  symbol: string
  symbol_display: string
  timeframe: string
  trade_duration: number
  indicators: string[]
  bar_limit: number
}

export interface SimulationStatus {
  id: string
  symbol: string
  symbol_display: string
  timeframe: string
  trade_duration: number
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED'
  progress_pct: number
  total_strategies: number | null
  total_bars: number | null
  error_message: string | null
  created_at: string | null
  completed_at: string | null
}

export interface StrategyResult {
  id: number
  sim_id: string
  rank: number | null
  strategy_name: string
  indicator_family: string
  parameters: string  // JSON string
  total_trades: number
  wins: number
  losses: number
  win_rate: number
  profit_factor: number | null
  expected_value: number | null   // profit_factor * total_trades
  hourly_ev: number | null        // EV per hour
  signal_bar_count: number | null
}

export interface ResultsResponse {
  sim_id: string
  total: number
  filtered: number
  page: number
  page_size: number
  results: StrategyResult[]
}

export interface OHLCVBar {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface TradeRecord {
  entry_time: number
  entry_price: number
  exit_time: number
  exit_price: number
  direction: 'CALL' | 'PUT'
  outcome: 'WIN' | 'LOSS'
}

export interface IndicatorSeries {
  name: string
  color: string
  pane: number
  series_type: 'line' | 'histogram'
  data: Array<{ time: number; value: number; color?: string }>
}

export interface ChartResponse {
  strategy_name: string
  win_rate: number
  total_trades: number
  wins: number
  losses: number
  ohlcv: OHLCVBar[]
  indicators: IndicatorSeries[]
  trades: TradeRecord[]
}

export interface BatchCreateRequest {
  symbol: string
  symbol_display: string
  indicators: string[]
  bar_limit: number
}

export interface BatchSimStatus {
  batch_id: string
  total: number
  completed: number
  failed: number
  refinement_batch_id: string | null
  simulations: SimulationStatus[]
}

export interface BatchResultItem {
  id: number
  sim_id: string
  timeframe: string
  trade_duration: number
  rank: number | null
  strategy_name: string
  indicator_family: string
  parameters: string
  total_trades: number
  wins: number
  losses: number
  win_rate: number
  profit_factor: number | null
  expected_value: number | null
  hourly_ev: number | null
}

export interface BatchResultsResponse {
  batch_id: string
  symbol: string
  symbol_display: string
  results_by_tf: Record<string, Record<string, BatchResultItem[]>>
}

export const INDICATOR_FAMILIES = [
  { key: 'SMA_CROSS', label: 'SMA クロス' },
  { key: 'EMA_CROSS', label: 'EMA クロス' },
  { key: 'RSI',       label: 'RSI' },
  { key: 'MACD',      label: 'MACD' },
  { key: 'BB',        label: 'ボリンジャーバンド' },
  { key: 'STOCH',     label: 'ストキャスティクス' },
  { key: 'RSI_MA',    label: 'RSI + MA (複合)' },
  { key: 'MACD_BB',   label: 'MACD + BB (複合)' },
]

export interface AutoCategoryInfo {
  batch_id: string
  created_at: number   // Unix timestamp
  next_run_at: number | null
}

export interface AutoLatestResponse {
  categories: Record<string, AutoCategoryInfo>
  is_running: boolean
  next_run_at: number | null
}

export const TIMEFRAMES = [
  { value: '1m',  label: '1分' },
  { value: '5m',  label: '5分' },
  { value: '15m', label: '15分' },
  { value: '1h',  label: '1時間' },
  { value: '4h',  label: '4時間' },
  { value: '1d',  label: '日足' },
]
