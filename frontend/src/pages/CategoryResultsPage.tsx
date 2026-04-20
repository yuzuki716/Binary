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

interface SimStatus {
  id: string
  symbol_display: string
  timeframe: string
  trade_duration: number
  status: string
  progress_pct: number
  total_bars: number | null
}

interface BatchStatus {
  batch_id: string
  total: number
  completed: number
  failed: number
  simulations: SimStatus[]
}

export default function CategoryResultsPage() {
  const { batchId } = useParams<{ batchId: string }>()
  const navigate = useNavigate()
  const [summary, setSummary] = useState<Summary | null>(null)
  const [minTrades, setMinTrades] = useState(10)
  const [minWinRate, setMinWinRate] = useState(55)
  const [loading, setLoading] = useState(true)
  const [payoutRates, setPayoutRates] = useState<Record<string, string>>({})
  const [showPayoutPanel, setShowPayoutPanel] = useState(false)

  const [refinementBatchId, setRefinementBatchId] = useState<string | null>(null)
  const [refinementDone, setRefinementDone] = useState(false)
  const [refinedSymbols, setRefinedSymbols] = useState<SymbolEntry[]>([])
  const [refinementSims, setRefinementSims] = useState<SimStatus[]>([])
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
        setRefinementSims(batch.simulations ?? [])
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

  const getEvPerTrade = (sym: SymbolEntry): number | null => {
    const top = sym.top_strategy
    if (!top) return null
    const pr = parseFloat(payoutRates[sym.symbol] ?? '')
    if (!isNaN(pr) && pr > 0 && pr <= 100) {
      return top.win_rate * (pr / 100) - (1 - top.win_rate)
    }
    if (top.expected_value != null && top.total_trades > 0) {
      return top.expected_value / top.total_trades
    }
    return null
  }

  const anyPayoutEntered = Object.values(payoutRates).some(v => { const n = parseFloat(v); return !isNaN(n) && n > 0 })

  // Sort symbols by payout-adjusted EV descending (nulls last)
  const sorted = summary?.symbols.slice().sort((a, b) => {
    return (getEvPerTrade(b) ?? -999) - (getEvPerTrade(a) ?? -999)
  }) ?? []

  // Sort refined symbols similarly
  const refinedSorted = refinedSymbols.slice().sort((a, b) => {
    return (getEvPerTrade(b) ?? -999) - (getEvPerTrade(a) ?? -999)
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
        <button
          onClick={() => setShowPayoutPanel(v => !v)}
          style={{ marginTop: '8px', background: anyPayoutEntered ? '#1e1040' : 'none', border: `1px solid ${anyPayoutEntered ? '#6d28d9' : '#334155'}`, color: anyPayoutEntered ? '#c4b5fd' : '#64748b', fontSize: '11px', fontWeight: '600', padding: '3px 10px', borderRadius: '6px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '5px' }}
        >
          💹 ペイアウト率 {anyPayoutEntered ? '（設定済み）' : 'を設定'}
          <span style={{ fontSize: '10px' }}>{showPayoutPanel ? '▲' : '▼'}</span>
        </button>
      </div>

      <div style={{ padding: '16px', maxWidth: '480px', margin: '0 auto' }}>

        {/* Payout panel */}
        {showPayoutPanel && summary && (
          <div style={{ border: '1px solid #4c1d95', borderRadius: '10px', background: '#0f0a1e', padding: '14px', marginBottom: '16px' }}>
            <div style={{ fontSize: '12px', fontWeight: '700', color: '#a78bfa', marginBottom: '12px' }}>
              ペイアウト率を入力（%） — EVを再計算します
            </div>
            {summary.symbols.map(sym => (
              <div key={sym.symbol} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                <span style={{ fontSize: '13px', color: '#e2e8f0', fontWeight: '600' }}>{sym.symbol_display}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <input
                    type="number" min={1} max={99} placeholder="—"
                    value={payoutRates[sym.symbol] ?? ''}
                    onChange={e => setPayoutRates(prev => ({ ...prev, [sym.symbol]: e.target.value }))}
                    style={{ width: '64px', padding: '5px 8px', textAlign: 'right', background: '#1e293b', border: '1px solid #334155', borderRadius: '6px', color: '#f1f5f9', fontSize: '14px', fontWeight: '700', outline: 'none' }}
                  />
                  <span style={{ fontSize: '12px', color: '#64748b' }}>%</span>
                </div>
              </div>
            ))}
          </div>
        )}

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

        {/* Refinement progress */}
        {refinementBatchId && !refinementDone && (
          <div style={{ marginBottom: '16px', border: '1px solid #4c1d95', borderRadius: '10px', overflow: 'hidden', background: '#0f0a1e' }}>
            <div style={{ padding: '10px 14px', background: '#1e1040', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#a78bfa', boxShadow: '0 0 6px #a78bfa' }} />
                <span style={{ fontSize: '12px', fontWeight: '700', color: '#a78bfa' }}>精密分析中</span>
              </div>
              <span style={{ fontSize: '11px', color: '#7c3aed' }}>
                {refinementSims.filter(s => s.status === 'COMPLETED' || s.status === 'FAILED').length} / {refinementSims.length} 完了
              </span>
            </div>
            {refinementSims.map((s, i) => {
              const pct = s.progress_pct ?? 0
              const done = s.status === 'COMPLETED'
              const failed = s.status === 'FAILED'
              const running = s.status === 'RUNNING'
              const barColor = done ? '#22c55e' : failed ? '#ef4444' : '#7c3aed'
              const TF_S: Record<string, string> = { '1m': '1分', '5m': '5分', '15m': '15分', '1h': '1時間' }
              return (
                <div key={s.id} style={{ borderBottom: i === refinementSims.length - 1 ? 'none' : '1px solid #1a1040', padding: '10px 14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <div style={{ fontSize: '12px', color: '#c4b5fd', fontWeight: '600' }}>
                      {s.symbol_display} · {TF_S[s.timeframe] ?? s.timeframe}足 / {s.trade_duration}分取引
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {s.total_bars && <span style={{ fontSize: '10px', color: '#475569' }}>{s.total_bars.toLocaleString()}本</span>}
                      <span style={{
                        fontSize: '10px', fontWeight: '700', padding: '1px 6px', borderRadius: '4px',
                        background: done ? '#0f2a1a' : failed ? '#1a0a0a' : running ? '#1e1040' : '#1e293b',
                        color: done ? '#4ade80' : failed ? '#f87171' : running ? '#a78bfa' : '#475569',
                      }}>
                        {done ? '完了' : failed ? '失敗' : running ? `${pct}%` : '待機中'}
                      </span>
                    </div>
                  </div>
                  <div style={{ height: '4px', borderRadius: '2px', background: '#1e1040', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: barColor, transition: 'width 0.5s ease' }} />
                  </div>
                </div>
              )
            })}
            {refinementSims.length === 0 && (
              <div style={{ padding: '12px 14px', fontSize: '12px', color: '#475569' }}>準備中...</div>
            )}
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
              ✨ 精密分析結果（最大データ量）— 上位5件
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
                        {(() => { const ev = getEvPerTrade(sym); return ev != null ? (
                          <span style={{ background: '#1a0e2e', color: '#c4b5fd', fontSize: '10px', fontWeight: '700', padding: '1px 6px', borderRadius: '4px', border: '1px solid #6d28d9' }}>
                            1回 {ev >= 0 ? '+' : ''}{ev.toFixed(3)}
                          </span>
                        ) : null })()}
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
          const evPerTrade = getEvPerTrade(sym)
          const recommended = top != null && top.total_trades >= 30 && evPerTrade != null && evPerTrade >= 0.07

          return (
            <div
              key={sym.symbol}
              style={{
                background: recommended ? '#050f07' : '#0a0f1e', borderRadius: '12px',
                border: `1px solid ${recommended ? '#16a34a' : top && top.win_rate >= 0.55 ? '#1d3461' : '#1e293b'}`,
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{ fontSize: '15px', fontWeight: '700', color: '#e2e8f0' }}>
                      {sym.symbol_display}
                    </div>
                    {recommended && (
                      <span style={{ flexShrink: 0, background: '#0a1f0a', color: '#4ade80', fontSize: '9px', fontWeight: '800', padding: '2px 6px', borderRadius: '4px', border: '1px solid #16a34a' }}>
                        ◆ 推奨
                      </span>
                    )}
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
                    {evPerTrade != null && (
                      <div style={{ fontSize: '11px', color: '#c4b5fd', fontWeight: '700' }}>
                        1回 {evPerTrade >= 0 ? '+' : ''}{evPerTrade.toFixed(3)}
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
