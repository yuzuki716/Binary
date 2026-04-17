import { useEffect, useRef, useState } from 'react'
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
  refinement_batch_id: string | null
  symbols: SymbolEntry[]
}

interface BatchStatus {
  batch_id: string
  total: number
  completed: number
  failed: number
}

export default function CategoryResultsPage() {
  const { batchId } = useParams<{ batchId: string }>()
  const navigate = useNavigate()
  const [summary, setSummary] = useState<Summary | null>(null)
  const [minTrades, setMinTrades] = useState(10)
  const [minWinRate, setMinWinRate] = useState(55)
  const [loading, setLoading] = useState(true)

  const [refinementBatchId, setRefinementBatchId] = useState<string | null>(null)
  const [refinementDone, setRefinementDone] = useState(false)
  const [refinedSymbols, setRefinedSymbols] = useState<SymbolEntry[]>([])
  const refinementRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!batchId) return
    setLoading(true)
    client.get<Summary>(`/batch/${batchId}/symbol-summary`, { params: { min_trades: minTrades, min_win_rate: minWinRate / 100 } })
      .then(({ data }) => {
        setSummary(data)
        if (data.refinement_batch_id && !refinementBatchId) {
          setRefinementBatchId(data.refinement_batch_id)
        }
      })
      .finally(() => setLoading(false))
  }, [batchId, minTrades, minWinRate])

  // Once we have refinement batch id, poll until done and load results
  useEffect(() => {
    if (!refinementBatchId) return
    refinementRef.current = setInterval(async () => {
      try {
        const { data: batch } = await client.get<BatchStatus>(`/batch/${refinementBatchId}`)
        const allDone = batch.completed + batch.failed === batch.total
        if (allDone) {
          clearInterval(refinementRef.current!)
          setRefinementDone(true)
          const { data: rd } = await client.get<Summary>(
            `/batch/${refinementBatchId}/symbol-summary`,
            { params: { min_trades: 5 } }
          )
          setRefinedSymbols(rd.symbols)
        }
      } catch { /* ignore */ }
    }, 3000)
    return () => clearInterval(refinementRef.current!)
  }, [refinementBatchId])

  // Sort symbols by expected_value descending (nulls last)
  const sorted = summary?.symbols.slice().sort((a, b) => {
    const ev = (s: SymbolEntry) => s.top_strategy?.expected_value ?? -1
    return ev(b) - ev(a)
  }) ?? []

  // Sort refined symbols by expected_value descending (nulls last)
  const refinedSorted = refinedSymbols.slice().sort((a, b) => {
    const ev = (s: SymbolEntry) => s.top_strategy?.expected_value ?? -1
    return ev(b) - ev(a)
  }).filter(s => s.top_strategy != null)

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
        {/* Filters */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '12px', color: '#64748b', whiteSpace: 'nowrap' }}>最低勝率</span>
            {[0, 50, 55, 60].map((n) => (
              <button key={n} onClick={() => setMinWinRate(n)} style={{
                padding: '4px 10px', borderRadius: '6px', border: 'none',
                background: minWinRate === n ? '#7c3aed' : '#1e293b',
                color: minWinRate === n ? '#fff' : '#64748b',
                fontSize: '12px', cursor: 'pointer',
              }}>
                {n === 0 ? '全て' : `${n}%+`}
              </button>
            ))}
          </div>
        </div>

        {loading && (
          <div style={{ textAlign: 'center', padding: '40px', color: '#475569' }}>読み込み中...</div>
        )}

        {/* Refinement status */}
        {refinementBatchId && !refinementDone && (
          <div style={{
            padding: '12px 14px', borderRadius: '10px', marginBottom: '16px',
            background: '#1e1040', border: '1px solid #4c1d95',
            display: 'flex', alignItems: 'center', gap: '10px',
          }}>
            <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#a78bfa', boxShadow: '0 0 6px #a78bfa', flexShrink: 0 }} />
            <span style={{ fontSize: '13px', color: '#c4b5fd' }}>
              上位5件を100000本で精密分析中...
            </span>
          </div>
        )}

        {/* Refinement results */}
        {refinementDone && refinedSorted.length > 0 && (
          <div style={{ marginBottom: '24px' }}>
            <div style={{
              padding: '8px 12px', borderRadius: '8px 8px 0 0',
              background: '#1e1040', border: '1px solid #4c1d95', borderBottom: 'none',
              fontSize: '12px', fontWeight: '700', color: '#a78bfa',
              display: 'flex', alignItems: 'center', gap: '6px',
            }}>
              ✨ 精密分析結果（100000本）— 上位5件
            </div>
            <div style={{ border: '1px solid #4c1d95', borderTop: 'none', borderRadius: '0 0 8px 8px', overflow: 'hidden' }}>
              {refinedSorted.map((sym, idx) => {
                const top = sym.top_strategy!
                return (
                  <div key={sym.symbol} style={{
                    padding: '12px 14px',
                    borderBottom: idx < refinedSorted.length - 1 ? '1px solid #2d1a6e' : 'none',
                    display: 'flex', alignItems: 'center', gap: '10px',
                    background: '#0f0a1e',
                  }}>
                    <div style={{
                      width: '24px', height: '24px', borderRadius: '50%',
                      background: idx === 0 ? '#f59e0b' : idx === 1 ? '#94a3b8' : idx === 2 ? '#b45309' : '#1e293b',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '11px', fontWeight: '800', color: idx < 3 ? '#000' : '#475569',
                      flexShrink: 0,
                    }}>
                      {idx + 1}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '14px', fontWeight: '700', color: '#e2e8f0' }}>
                        {sym.symbol_display}
                      </div>
                      <div style={{ fontSize: '11px', color: '#7c3aed', marginTop: '1px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {TF_LABEL[top.timeframe]} / {top.trade_duration}分取引 / {top.strategy_name}
                      </div>
                      <div style={{ display: 'flex', gap: '5px', marginTop: '4px', flexWrap: 'wrap' }}>
                        {top.expected_value != null && (
                          <span style={{ background: '#1e1040', color: '#a78bfa', fontSize: '10px', fontWeight: '700', padding: '1px 6px', borderRadius: '4px', border: '1px solid #4c1d95' }}>
                            EV {top.expected_value.toFixed(1)}
                          </span>
                        )}
                        {top.hourly_ev != null && (
                          <span style={{ background: '#0f2a1a', color: '#4ade80', fontSize: '10px', fontWeight: '700', padding: '1px 6px', borderRadius: '4px', border: '1px solid #166534' }}>
                            毎時 {top.hourly_ev.toFixed(2)}
                          </span>
                        )}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: '18px', fontWeight: '800', color: winColor(top.win_rate) }}>
                        {Math.round(top.win_rate * 100)}%
                      </div>
                      <div style={{ fontSize: '11px', color: '#475569' }}>{top.total_trades}回</div>
                      <button
                        onClick={() => navigate(`/results/${top.sim_id}/chart/${top.id}`)}
                        style={{ background: 'none', border: 'none', color: '#3b82f6', fontSize: '11px', cursor: 'pointer', padding: '2px 0', marginTop: '2px' }}
                      >
                        詳細 →
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
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
