import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import client from '../api/client'

const TF_LABEL: Record<string, string> = { '1m': '1分足', '5m': '5分足', '15m': '15分足', '1h': '1時間足' }

function winColor(r: number) {
  if (r >= 0.6) return '#22c55e'
  if (r >= 0.55) return '#84cc16'
  if (r >= 0.5) return '#eab308'
  return '#ef4444'
}

interface TopStrategy {
  id: number
  sim_id: string
  strategy_name: string
  timeframe: string
  trade_duration: number
  win_rate: number
  total_trades: number
  wins: number
  losses: number
  parameters: string
  expected_value: number | null
  hourly_ev: number | null
}

interface SymbolEntry {
  symbol: string
  symbol_display: string
  top_strategy: TopStrategy | null
  grid: Record<string, Record<string, { status: string }>>
}

interface Summary {
  batch_id: string
  total: number
  completed: number
  failed: number
  symbols: SymbolEntry[]
}

export default function CategoryResultsPage() {
  const { batchId } = useParams<{ batchId: string }>()
  const navigate = useNavigate()
  const [summary, setSummary] = useState<Summary | null>(null)
  const [minTrades, setMinTrades] = useState(10)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!batchId) return
    setLoading(true)
    client.get<Summary>(`/batch/${batchId}/symbol-summary`, { params: { min_trades: minTrades } })
      .then(({ data }) => setSummary(data))
      .finally(() => setLoading(false))
  }, [batchId, minTrades])

  // Sort symbols by expected_value descending (nulls last)
  const sorted = summary?.symbols.slice().sort((a, b) => {
    const ev = (s: SymbolEntry) => s.top_strategy?.expected_value ?? -1
    return ev(b) - ev(a)
  }) ?? []

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', paddingBottom: '80px' }}>
      <div style={{ padding: '20px 16px 12px', borderBottom: '1px solid #1e293b' }}>
        <button
          onClick={() => navigate('/')}
          style={{ background: 'none', border: 'none', color: '#64748b', fontSize: '13px', cursor: 'pointer', padding: 0, marginBottom: '8px' }}
        >
          ← 設定に戻る
        </button>
        <h1 style={{ margin: 0, fontSize: '18px', fontWeight: '700', color: '#f1f5f9' }}>
          グループ分析結果
        </h1>
        {summary && (
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>
            {summary.symbols.length} 銘柄 · {summary.completed}/{summary.total} 完了
          </p>
        )}
      </div>

      <div style={{ padding: '16px', maxWidth: '480px', margin: '0 auto' }}>
        {/* Min trades filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
          <span style={{ fontSize: '12px', color: '#64748b', whiteSpace: 'nowrap' }}>最低取引数</span>
          {[5, 10, 20, 30].map((n) => (
            <button key={n} onClick={() => setMinTrades(n)} style={{
              padding: '4px 10px', borderRadius: '6px', border: 'none',
              background: minTrades === n ? '#7c3aed' : '#1e293b',
              color: minTrades === n ? '#fff' : '#64748b',
              fontSize: '12px', cursor: 'pointer',
            }}>
              {n}+
            </button>
          ))}
        </div>

        {loading && (
          <div style={{ textAlign: 'center', padding: '40px', color: '#475569' }}>読み込み中...</div>
        )}

        {/* Leaderboard */}
        {!loading && sorted.map((sym, idx) => {
          const top = sym.top_strategy
          const allDone = Object.values(sym.grid).flatMap(Object.values)
            .every((c) => c.status === 'COMPLETED' || c.status === 'FAILED')

          return (
            <div
              key={sym.symbol}
              style={{
                background: '#0a0f1e', borderRadius: '12px',
                border: `1px solid ${top && top.win_rate >= 0.55 ? '#1d3461' : '#1e293b'}`,
                marginBottom: '10px', overflow: 'hidden',
              }}
            >
              {/* Symbol row */}
              <div style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                {/* Rank badge */}
                <div style={{
                  width: '28px', height: '28px', borderRadius: '50%',
                  background: idx === 0 ? '#f59e0b' : idx === 1 ? '#94a3b8' : idx === 2 ? '#b45309' : '#1e293b',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '12px', fontWeight: '800', color: idx < 3 ? '#000' : '#475569',
                  flexShrink: 0,
                }}>
                  {idx + 1}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '15px', fontWeight: '700', color: '#e2e8f0' }}>
                    {sym.symbol_display}
                  </div>
                  {top ? (
                    <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {TF_LABEL[top.timeframe]} / {top.trade_duration}分取引 / {top.strategy_name}
                    </div>
                  ) : (
                    <div style={{ fontSize: '12px', color: '#334155', marginTop: '2px' }}>
                      {allDone ? '条件に合う結果なし' : '分析中...'}
                    </div>
                  )}
                </div>

                {top ? (
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: '20px', fontWeight: '800', color: winColor(top.win_rate) }}>
                      {Math.round(top.win_rate * 100)}%
                    </div>
                    <div style={{ fontSize: '11px', color: '#475569' }}>{top.total_trades}回</div>
                    {top.expected_value != null && (
                      <div style={{ fontSize: '11px', color: '#a78bfa', fontWeight: '700' }}>
                        EV {top.expected_value.toFixed(1)}
                      </div>
                    )}
                    {top.hourly_ev != null && (
                      <div style={{ fontSize: '11px', color: '#4ade80', fontWeight: '600' }}>
                        毎時 {top.hourly_ev.toFixed(2)}
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ fontSize: '12px', color: '#334155' }}>—</div>
                )}
              </div>

              {/* Win rate bar */}
              {top && (
                <div style={{ height: '3px', background: '#1e293b' }}>
                  <div style={{
                    height: '100%',
                    width: `${Math.min(top.win_rate * 100, 100)}%`,
                    background: winColor(top.win_rate),
                  }} />
                </div>
              )}

              {/* Chart link */}
              {top && (
                <button
                  onClick={() => navigate(`/results/${top.sim_id}/chart/${top.id}`)}
                  style={{
                    width: '100%', padding: '8px',
                    background: 'none', border: 'none', borderTop: '1px solid #1e293b',
                    color: '#3b82f6', fontSize: '12px', cursor: 'pointer',
                    textAlign: 'center',
                  }}
                >
                  詳細チャートを見る →
                </button>
              )}
            </div>
          )
        })}

        {!loading && sorted.length === 0 && (
          <p style={{ color: '#475569', textAlign: 'center', padding: '40px' }}>
            結果がありません
          </p>
        )}
      </div>
    </div>
  )
}
