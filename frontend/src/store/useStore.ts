import { create } from 'zustand'
import type { SimulationStatus, StrategyResult } from '../types'

interface SimStore {
  // Setup state
  symbol: string
  symbolDisplay: string
  timeframe: string
  tradeDuration: number
  selectedIndicators: string[]
  barLimit: number

  // Simulation state
  currentSim: SimulationStatus | null
  results: StrategyResult[]
  selectedStrategy: StrategyResult | null

  // Payout rates (persisted) — keyed by symbol_display e.g. "BTC/USDT"
  payoutRates: Record<string, string>

  // Actions
  setSymbol: (key: string, display: string) => void
  setTimeframe: (tf: string) => void
  setTradeDuration: (d: number) => void
  toggleIndicator: (key: string) => void
  setAllIndicators: (keys: string[]) => void
  setBarLimit: (n: number) => void
  setCurrentSim: (sim: SimulationStatus | null) => void
  updateSimStatus: (sim: SimulationStatus) => void
  setResults: (results: StrategyResult[]) => void
  setSelectedStrategy: (s: StrategyResult | null) => void
  setPayoutRate: (symbolDisplay: string, rate: string) => void
}

const ALL_INDICATORS = ['SMA_CROSS', 'EMA_CROSS', 'RSI', 'MACD', 'BB', 'STOCH', 'RSI_MA', 'MACD_BB']

function loadPayoutRates(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem('payoutRates') || '{}') } catch { return {} }
}

export const useStore = create<SimStore>((set) => ({
  symbol: 'BTCUSDT',
  symbolDisplay: 'BTC/USDT',
  timeframe: '5m',
  tradeDuration: 1,
  selectedIndicators: ALL_INDICATORS,
  barLimit: 2000,

  currentSim: null,
  results: [],
  selectedStrategy: null,

  payoutRates: loadPayoutRates(),

  setSymbol: (key, display) => set({ symbol: key, symbolDisplay: display }),
  setTimeframe: (tf) => set({ timeframe: tf }),
  setTradeDuration: (d) => set({ tradeDuration: d }),
  toggleIndicator: (key) => set((state) => ({
    selectedIndicators: state.selectedIndicators.includes(key)
      ? state.selectedIndicators.filter((k) => k !== key)
      : [...state.selectedIndicators, key]
  })),
  setAllIndicators: (keys) => set({ selectedIndicators: keys }),
  setBarLimit: (n) => set({ barLimit: n }),
  setCurrentSim: (sim) => set({ currentSim: sim }),
  updateSimStatus: (sim) => set({ currentSim: sim }),
  setResults: (results) => set({ results }),
  setSelectedStrategy: (s) => set({ selectedStrategy: s }),
  setPayoutRate: (symbolDisplay, rate) => set((state) => {
    const next = { ...state.payoutRates, [symbolDisplay]: rate }
    try { localStorage.setItem('payoutRates', JSON.stringify(next)) } catch { /* ignore */ }
    return { payoutRates: next }
  }),
}))
