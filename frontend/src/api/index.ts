import client from './client'
import type {
  SymbolsResponse, SimulationCreate, SimulationStatus,
  ResultsResponse, ChartResponse,
  BatchCreateRequest, BatchSimStatus, BatchResultsResponse,
  AutoLatestResponse,
} from '../types'

export async function fetchSymbols(): Promise<SymbolsResponse> {
  const res = await client.get<SymbolsResponse>('/symbols')
  return res.data
}

export async function createSimulation(body: SimulationCreate): Promise<SimulationStatus> {
  const res = await client.post<SimulationStatus>('/simulations', body)
  return res.data
}

export async function getSimulation(simId: string): Promise<SimulationStatus> {
  const res = await client.get<SimulationStatus>(`/simulations/${simId}`)
  return res.data
}

export async function listSimulations(): Promise<SimulationStatus[]> {
  const res = await client.get<SimulationStatus[]>('/simulations')
  return res.data
}

export async function fetchResults(
  simId: string,
  params: {
    sort?: string
    order?: string
    min_trades?: number
    min_win_rate?: number
    family?: string
    page?: number
    page_size?: number
  } = {}
): Promise<ResultsResponse> {
  const res = await client.get<ResultsResponse>(`/results/${simId}`, { params })
  return res.data
}

export async function fetchResultsSummary(simId: string) {
  const res = await client.get(`/results/${simId}/summary`)
  return res.data
}

export async function fetchChart(simId: string, strategyId: number): Promise<ChartResponse> {
  const res = await client.get<ChartResponse>(`/charts/${simId}/strategy/${strategyId}`)
  return res.data
}

export async function createBatch(body: BatchCreateRequest): Promise<{ batch_id: string; sim_ids: string[]; total: number }> {
  const res = await client.post('/batch', body)
  return res.data
}

export async function getBatch(batchId: string): Promise<BatchSimStatus> {
  const res = await client.get<BatchSimStatus>(`/batch/${batchId}`)
  return res.data
}

export async function getBatchResults(batchId: string, minTrades = 10, minWinRate = 0.55): Promise<BatchResultsResponse> {
  const res = await client.get<BatchResultsResponse>(`/batch/${batchId}/results`, { params: { min_trades: minTrades, min_win_rate: minWinRate } })
  return res.data
}

export async function fetchAutoLatest(): Promise<AutoLatestResponse> {
  const res = await client.get<AutoLatestResponse>('/auto/latest')
  return res.data
}
