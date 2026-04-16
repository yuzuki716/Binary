import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listSimulations } from '../api'
import type { SimulationStatus } from '../types'

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  PENDING: { label: '待機中', color: '#64748b' },
  RUNNING: { label: '実行中', color: '#3b82f6' },
  COMPLETED: { label: '完了', color: '#22c55e' },
  FAILED: { label: 'エラー', color: '#ef4444' },
}

export default function HistoryPage() {
  const navigate = useNavigate()
  const [sims, setSims] = useState<SimulationStatus[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    listSimulations().then((data) => {
      setSims(data)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const handleClick = (sim: SimulationStatus) => {
    if (sim.status === 'COMPLETED') {
      navigate(`/results/${sim.id}`)
    } else if (sim.status === 'RUNNING') {
      navigate(`/progress/${sim.id}`)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', paddingBottom: '80px' }}>
      <div style={{ padding: '20px 16px 12px', borderBottom: '1px solid #1e293b' }}>
        <h1 style={{ margin: 0, fontSize: '20px', fontWeight: '700', color: '#f1f5f9' }}>
          実行履歴
        </h1>
      </div>

      <div style={{ padding: '12px' }}>
        {loading && (
          <div style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>読み込み中...</div>
        )}

        {!loading && sims.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: '#64748b' }}>
            <div style={{ fontSize: '40px', marginBottom: '12px' }}>📊</div>
            <div>まだシミュレーション履歴がありません</div>
            <button
              onClick={() => navigate('/')}
              style={{
                marginTop: '16px', padding: '10px 20px',
                borderRadius: '8px', border: 'none',
                background: '#3b82f6', color: '#fff',
                fontSize: '14px', cursor: 'pointer',
              }}
            >
              シミュレーションを開始
            </button>
          </div>
        )}

        {sims.map((sim) => {
          const st = STATUS_LABELS[sim.status] || { label: sim.status, color: '#64748b' }
          const date = sim.created_at
            ? new Date(sim.created_at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
            : '—'

          return (
            <div
              key={sim.id}
              onClick={() => handleClick(sim)}
              style={{
                background: '#1e293b',
                borderRadius: '12px',
                padding: '14px',
                marginBottom: '8px',
                cursor: sim.status === 'COMPLETED' || sim.status === 'RUNNING' ? 'pointer' : 'default',
                border: '1px solid #334155',
                transition: 'background 0.15s',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: '15px', fontWeight: '700', color: '#f1f5f9' }}>
                    {sim.symbol_display}
                  </div>
                  <div style={{ fontSize: '12px', color: '#64748b', marginTop: '3px' }}>
                    {sim.timeframe} / {sim.trade_duration}分取引 · {sim.total_strategies || 0} ストラテジー
                  </div>
                  <div style={{ fontSize: '11px', color: '#475569', marginTop: '2px' }}>{date}</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                  <span style={{
                    background: '#0f172a',
                    color: st.color,
                    fontSize: '11px',
                    fontWeight: '600',
                    padding: '3px 8px',
                    borderRadius: '12px',
                    border: `1px solid ${st.color}40`,
                  }}>
                    {st.label}
                  </span>
                  {sim.status === 'RUNNING' && (
                    <span style={{ fontSize: '11px', color: '#3b82f6' }}>
                      {sim.progress_pct}%
                    </span>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
