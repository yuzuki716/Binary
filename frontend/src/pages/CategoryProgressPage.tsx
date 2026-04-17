import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import client from '../api/client'

const TF_LABELS: Record<string, string> = { '1m': '1m', '5m': '5m', '15m': '15m', '1h': '1h' }
const STATUS_COLOR: Record<string, string> = {
  PENDING: '#334155', RUNNING: '#3b82f6', COMPLETED: '#22c55e', FAILED: '#ef4444',
}

interface SymbolEntry {
  symbol: string
  symbol_display: string
  grid: Record<string, Record<string, { status: string; progress_pct: number; sim_id: string }>>
  top_strategy: null | {
    strategy_name: string; timeframe: string; trade_duration: number
    win_rate: number; total_trades: number
  }
}

interface Summary {
  batch_id: string
  total: number
  completed: number
  failed: number
  symbols: SymbolEntry[]
}

export default function CategoryProgressPage() {
  const { batchId } = useParams<{ batchId: string }>()
  const navigate = useNavigate()
  const [summary, setSummary] = useState<Summary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!batchId) return

    const poll = async () => {
      try {
        const { data } = await client.get<Summary>(`/batch/${batchId}/symbol-summary`)
        setSummary(data)
        if (data.completed + data.failed === data.total) {
          clearInterval(intervalRef.current!)
          navigate(`/category-results/${batchId}`)
        }
      } catch (e: any) {
        setError(e.message)
        clearInterval(intervalRef.current!)
      }
    }

    poll()
    intervalRef.current = setInterval(poll, 2500)
    return () => clearInterval(intervalRef.current!)
  }, [batchId])

  const pct = summary ? Math.round((summary.completed / summary.total) * 100) : 0

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '20px 16px 12px', borderBottom: '1px solid #1e293b' }}>
        <h1 style={{ margin: 0, fontSize: '18px', fontWeight: '700', color: '#f1f5f9' }}>
          グループ一括分析 実行中
        </h1>
        {summary && (
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>
            {summary.completed}/{summary.total} 完了
            {summary.failed > 0 && <span style={{ color: '#ef4444', marginLeft: '8px' }}>{summary.failed} 失敗</span>}
          </p>
        )}
      </div>

      <div style={{ flex: 1, padding: '20px 16px', maxWidth: '480px', margin: '0 auto', width: '100%' }}>
        {/* Overall progress */}
        <div style={{ marginBottom: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontSize: '13px', color: '#94a3b8' }}>全体進捗</span>
            <span style={{ fontSize: '13px', fontWeight: '700', color: '#f1f5f9' }}>{pct}%</span>
          </div>
          <div style={{ height: '8px', borderRadius: '4px', background: '#1e293b', overflow: 'hidden' }}>
            <div style={{
              height: '100%', width: `${pct}%`,
              background: pct === 100 ? '#22c55e' : '#7c3aed',
              borderRadius: '4px', transition: 'width 0.4s ease',
            }} />
          </div>
          <p style={{ margin: '8px 0 0', fontSize: '11px', color: '#475569', textAlign: 'center' }}>
            同時実行数は最大3件に制限されています（Render無料枠保護）
          </p>
        </div>

        {/* Symbol cards */}
        {summary?.symbols.map((sym) => {
          const symTotal = Object.values(sym.grid).flatMap(Object.values).length
          const symDone = Object.values(sym.grid).flatMap(Object.values)
            .filter((c) => c.status === 'COMPLETED' || c.status === 'FAILED').length

          return (
            <div key={sym.symbol} style={{
              background: '#0a0f1e', borderRadius: '12px',
              border: '1px solid #1e293b', marginBottom: '10px', overflow: 'hidden',
            }}>
              {/* Symbol header */}
              <div style={{
                padding: '10px 14px',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                borderBottom: '1px solid #1e293b',
              }}>
                <span style={{ fontSize: '14px', fontWeight: '700', color: '#e2e8f0' }}>
                  {sym.symbol_display}
                </span>
                <span style={{ fontSize: '12px', color: '#475569' }}>
                  {symDone}/{symTotal}
                </span>
              </div>

              {/* TF × Duration grid */}
              <div style={{ padding: '10px 14px' }}>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'auto repeat(4, 1fr)',
                  gap: '4px',
                  fontSize: '11px',
                }}>
                  {/* Header row */}
                  <div />
                  {['1m', '5m', '15m', '1h'].map((tf) => (
                    <div key={tf} style={{ textAlign: 'center', color: '#475569', fontWeight: '600' }}>
                      {TF_LABELS[tf]}
                    </div>
                  ))}
                  {/* Duration rows */}
                  {[1, 5].map((dur) => (
                    <>
                      <div key={`lbl-${dur}`} style={{ color: '#475569', fontWeight: '600', display: 'flex', alignItems: 'center' }}>
                        {dur}分
                      </div>
                      {['1m', '5m', '15m', '1h'].map((tf) => {
                        const cell = sym.grid[tf]?.[String(dur)]
                        const color = STATUS_COLOR[cell?.status || 'PENDING']
                        const isRunning = cell?.status === 'RUNNING'
                        return (
                          <div key={`${tf}-${dur}`} style={{
                            height: '22px', borderRadius: '4px',
                            background: '#1e293b',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            overflow: 'hidden', position: 'relative',
                          }}>
                            <div style={{
                              position: 'absolute', left: 0, top: 0, bottom: 0,
                              width: `${cell?.progress_pct || 0}%`,
                              background: color,
                              opacity: 0.3,
                              transition: 'width 0.4s ease',
                            }} />
                            <div style={{
                              width: '6px', height: '6px', borderRadius: '50%',
                              background: color,
                              boxShadow: isRunning ? `0 0 4px ${color}` : 'none',
                              zIndex: 1,
                            }} />
                          </div>
                        )
                      })}
                    </>
                  ))}
                </div>
              </div>
            </div>
          )
        })}

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
          onClick={() => navigate('/')}
          style={{
            width: '100%', marginTop: '20px', padding: '12px',
            borderRadius: '10px', border: '1px solid #334155',
            background: 'none', color: '#94a3b8', fontSize: '14px', cursor: 'pointer',
          }}
        >
          ← 設定に戻る
        </button>
      </div>
    </div>
  )
}
