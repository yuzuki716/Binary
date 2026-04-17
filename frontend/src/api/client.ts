import axios from 'axios'

export const API_BASE = import.meta.env.VITE_API_URL || '/api'

// Derive WebSocket base from API URL (wss:// for https, ws:// for http)
export function getWsBase(): string {
  if (import.meta.env.VITE_API_URL) {
    const url = new URL(import.meta.env.VITE_API_URL as string)
    const proto = url.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${proto}//${url.host}`
  }
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}`
}

const client = axios.create({
  baseURL: API_BASE,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
})

client.interceptors.response.use(
  (res) => res,
  (err) => {
    const msg = err.response?.data?.detail || err.message || '通信エラーが発生しました'
    return Promise.reject(new Error(msg))
  }
)

export default client
