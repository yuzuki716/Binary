import { useEffect, useState, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../store/useStore'
import { getSimulation } from '../api'
import { getWsBase } from '../api/client'

interface LogEntry {
  message: string
  pct: number
  ts: number
}

export default function ProgressPage() {
  const { simId } = useParams<{ simId: string }>()
  const navigate = useNavigate()
  const { currentSim, updateSimStatus } = useStore()

  const [logs, setLogs] = useState<LogEntry[]>([])
  const [pct, setPct] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const logsEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!simId) return

    const ws = new WebSocket(`${getWsBase()}/ws/progress/${simId}`)
    wsRef.current = ws

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data)
      if (msg.type === 'progress') {
        setPct(msg.percent)
        setLogs((prev) => [...prev.slice(-50), { message: msg.message, pct: msg.percent, ts: Date.now() }])
      } else if (msg.type === 'complete') {
        setPct(100)
        navigate(`/results/${simId}`)
      } else if (msg.type === 'error') {
        setError(msg.message)
      }
    }

    ws.onerror = () => {
      // Fallback: poll simulation status
      const poll = setInterval(async () => {
        try {
          const sim = await getSimulation(simId!)
          updateSimStatus(sim)
          setPct(sim.progress_pct)
          if (sim.status === 'COMPLETED') {
            clearInterval(poll)
            navigate(`/results/${simId}`)
          } else if (sim.status === 'FAILED') {
            clearInterval(poll)
            setError(sim.error_message || 'シミュレーション失敗')
          }
        } catch (_) {}
      }, 2000)
      return () => clearInterval(poll)
    }

    return () => {
      ws.close()
    }
  }, [simId])

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  const handleCancel = () => navigate('/')

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ padding: '20px 16px 12px', borderBottom: '1px solid #1e293b' }}>
        <h1 style={{ margin: 0, fontSize: '18px', fontWeight: '700', color: '#f1f5f9' }}>
          シミュレーション実行中
        </h1>
        {currentSim && (
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>
            {currentSim.symbol_display} / {currentSim.timeframe} / {currentSim.trade_duration}分取引
          </p>
        )}
      </div>

      <div style={{ flex: 1, padding: '24px 16px', maxWidth: '480px', margin: '0 auto', width: '100%' }}>
        {/* Progress circle */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '32px' }}>
          <CircularProgress pct={pct} />
          <p style={{ marginTop: '16px', fontSize: '14px', color: '#64748b', textAlign: 'center' }}>
            {pct < 10 ? 'データ取得中...' :
             pct < 90 ? 'ストラテジーをテスト中...' :
             pct < 100 ? '結果を保存中...' :
             '完了！'}
          </p>
          {currentSim?.total_strategies && (
            <p style={{ fontSize: '12px', color: '#475569', margin: '4px 0 0' }}>
              {currentSim.total_strategies} パターン / {currentSim.total_bars?.toLocaleString() || '...'} 本
            </p>
          )}
        </div>

        {/* Progress bar */}
        <div style={{
          height: '6px', borderRadius: '3px', background: '#1e293b',
          overflow: 'hidden', marginBottom: '20px'
        }}>
          <div style={{
            height: '100%',
            width: `${pct}%`,
            background: pct === 100 ? '#22c55e' : '#3b82f6',
            borderRadius: '3px',
            transition: 'width 0.5s ease',
          }} />
        </div>

        {/* Log scroll area */}
        <div style={{
          background: '#0a0f1e',
          borderRadius: '12px',
          padding: '12px',
          height: '200px',
          overflowY: 'auto',
          fontFamily: 'monospace',
          fontSize: '12px',
          color: '#64748b',
          border: '1px solid #1e293b',
        }}>
          {logs.map((log, i) => (
            <div key={log.ts} style={{ marginBottom: '4px', color: i === logs.length - 1 ? '#94a3b8' : '#475569' }}>
              [{log.pct}%] {log.message}
            </div>
          ))}
          {logs.length === 0 && (
            <span style={{ color: '#334155' }}>ログを待機中...</span>
          )}
          <div ref={logsEndRef} />
        </div>

        {error && (
          <div style={{
            marginTop: '16px', padding: '12px', borderRadius: '8px',
            background: '#1e0a0a', border: '1px solid #ef4444',
            color: '#fca5a5', fontSize: '13px',
          }}>
            エラー: {error}
          </div>
        )}

        <button
          onClick={handleCancel}
          style={{
            width: '100%', marginTop: '20px', padding: '12px',
            borderRadius: '10px', border: '1px solid #334155',
            background: 'none', color: '#94a3b8', fontSize: '14px',
            cursor: 'pointer',
          }}
        >
          ← 設定に戻る
        </button>
      </div>
    </div>
  )
}

function CircularProgress({ pct }: { pct: number }) {
  const r = 54
  const circumference = 2 * Math.PI * r
  const dash = (pct / 100) * circumference

  return (
    <svg width="140" height="140" viewBox="0 0 140 140">
      <circle cx="70" cy="70" r={r} fill="none" stroke="#1e293b" strokeWidth="10" />
      <circle
        cx="70" cy="70" r={r}
        fill="none"
        stroke={pct === 100 ? '#22c55e' : '#3b82f6'}
        strokeWidth="10"
        strokeDasharray={`${dash} ${circumference}`}
        strokeDashoffset={circumference / 4}
        strokeLinecap="round"
        style={{ transition: 'stroke-dasharray 0.5s ease' }}
      />
      <text x="70" y="70" textAnchor="middle" dominantBaseline="central"
        fill="#f1f5f9" fontSize="24" fontWeight="700">
        {pct}%
      </text>
    </svg>
  )
}
