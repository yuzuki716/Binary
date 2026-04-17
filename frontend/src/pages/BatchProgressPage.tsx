import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getBatch } from '../api'
import type { BatchSimStatus } from '../types'

const TF_LABELS: Record<string, string> = { '1m': '1分足', '5m': '5分足', '15m': '15分足', '1h': '1時間足' }
const DUR_LABELS: Record<number, string> = { 1: '1分取引', 5: '5分取引' }

const STATUS_COLOR: Record<string, string> = {
  PENDING: '#475569',
  RUNNING: '#3b82f6',
  COMPLETED: '#22c55e',
  FAILED: '#ef4444',
}

const STATUS_LABEL: Record<string, string> = {
  PENDING: '待機中',
  RUNNING: '実行中',
  COMPLETED: '完了',
  FAILED: '失敗',
}

export default function BatchProgressPage() {
  const { batchId } = useParams<{ batchId: string }>()
  const navigate = useNavigate()
  const [batch, setBatch] = useState<BatchSimStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!batchId) return

    const poll = async () => {
      try {
        const data = await getBatch(batchId)
        setBatch(data)

        const allDone = data.simulations.every(
          (s) => s.status === 'COMPLETED' || s.status === 'FAILED'
        )
        if (allDone) {
          clearInterval(intervalRef.current!)
          navigate(`/batch-results/${batchId}`)
        }
      } catch (e: any) {
        setError(e.message)
        clearInterval(intervalRef.current!)
      }
    }

    poll()
    intervalRef.current = setInterval(poll, 2000)
    return () => clearInterval(intervalRef.current!)
  }, [batchId])

  const totalPct = batch
    ? Math.round(
        batch.simulations.reduce((sum, s) => sum + s.progress_pct, 0) / batch.total
      )
    : 0

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '20px 16px 12px', borderBottom: '1px solid #1e293b' }}>
        <h1 style={{ margin: 0, fontSize: '18px', fontWeight: '700', color: '#f1f5f9' }}>
          一括分析 実行中
        </h1>
        {batch && (
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>
            {batch.completed}/{batch.total} 完了
            {batch.failed > 0 && <span style={{ color: '#ef4444', marginLeft: '8px' }}>{batch.failed} 失敗</span>}
          </p>
        )}
      </div>

      <div style={{ flex: 1, padding: '24px 16px', maxWidth: '480px', margin: '0 auto', width: '100%' }}>
        {/* Overall progress bar */}
        <div style={{ marginBottom: '28px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontSize: '13px', color: '#94a3b8' }}>全体進捗</span>
            <span style={{ fontSize: '13px', fontWeight: '700', color: '#f1f5f9' }}>{totalPct}%</span>
          </div>
          <div style={{ height: '8px', borderRadius: '4px', background: '#1e293b', overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${totalPct}%`,
              background: totalPct === 100 ? '#22c55e' : '#3b82f6',
              borderRadius: '4px',
              transition: 'width 0.4s ease',
            }} />
          </div>
        </div>

        {/* Grid: 4 timeframes × 2 durations */}
        {batch && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {['1m', '5m', '15m', '1h'].map((tf) => (
              <div key={tf} style={{
                background: '#0a0f1e',
                borderRadius: '12px',
                border: '1px solid #1e293b',
                overflow: 'hidden',
              }}>
                <div style={{
                  padding: '8px 14px',
                  background: '#1e293b',
                  fontSize: '13px',
                  fontWeight: '700',
                  color: '#94a3b8',
                }}>
                  {TF_LABELS[tf]}
                </div>
                <div style={{ display: 'flex' }}>
                  {[1, 5].map((dur) => {
                    const sim = batch.simulations.find(
                      (s) => s.timeframe === tf && s.trade_duration === dur
                    )
                    const color = STATUS_COLOR[sim?.status || 'PENDING']
                    return (
                      <div key={dur} style={{
                        flex: 1,
                        padding: '12px 14px',
                        borderRight: dur === 1 ? '1px solid #1e293b' : 'none',
                      }}>
                        <div style={{ fontSize: '12px', color: '#475569', marginBottom: '6px' }}>
                          {DUR_LABELS[dur]}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                          <div style={{
                            width: '8px', height: '8px', borderRadius: '50%',
                            background: color,
                            boxShadow: sim?.status === 'RUNNING' ? `0 0 6px ${color}` : 'none',
                          }} />
                          <span style={{ fontSize: '12px', color, fontWeight: '600' }}>
                            {STATUS_LABEL[sim?.status || 'PENDING']}
                          </span>
                        </div>
                        <div style={{ height: '3px', borderRadius: '2px', background: '#1e293b', overflow: 'hidden' }}>
                          <div style={{
                            height: '100%',
                            width: `${sim?.progress_pct || 0}%`,
                            background: color,
                            transition: 'width 0.4s ease',
                          }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

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
            width: '100%', marginTop: '24px', padding: '12px',
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
