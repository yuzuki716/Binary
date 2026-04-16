import client from './client'
import type {
  SymbolsResponse, SimulationCreate, SimulationStatus,
  ResultsResponse, ChartResponse
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
