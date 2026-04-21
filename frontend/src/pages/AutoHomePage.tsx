import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchAutoLatest, sendNotifyTest } from '../api'
import client from '../api/client'
import type { AutoCategoryInfo } from '../types'
import { computeFixedDiscount } from '../utils/ev'
import { useStore } from '../store/useStore'

const CATEGORIES = [
  { key: 'crypto', label: '暗号資産' },
  { key: 'forex',  label: '為替' },
]

const TF_LABEL: Record<string, string> = {
  '1m': '1分足', '5m': '5分足', '15m': '15分足', '1h': '1時間足',
}

function winColor(r: number) {
  if (r >= 0.6) return '#22c55e'
  if (r >= 0.55) return '#84cc16'
  if (r >= 0.5) return '#eab308'
  return '#ef4444'
}

function timeAgo(unix: number): string {
  const diff = Math.floor(Date.now() / 1000) - unix
  if (diff < 60) return `${diff}秒前`
  if (diff < 3600) return `${Math.floor(diff / 60)}分前`
  return `${Math.floor(diff / 3600)}時間前`
}

function timeUntil(unix: number): string {
  const diff = unix - Math.floor(Date.now() / 1000)
  if (diff <= 0) return 'まもなく'
  if (diff < 60) return `${diff}秒後`
  return `${Math.floor(diff / 60)}分後`
}

interface TopStrategy {
  id: number
  sim_id: string
  strategy_name: string
  timeframe: string
  trade_duration: number
  win_rate: number
  total_trades: number
  expected_value: number | null
  hourly_ev: number | null
}

interface SymbolEntry {
  symbol: string
  symbol_display: string
  top_strategy: TopStrategy | null
}

export default function AutoHomePage() {
  const navigate = useNavigate()
  const { payoutRates, setPayoutRate } = useStore()
  const [activeCategory, setActiveCategory] = useState('crypto')
  const [autoInfo, setAutoInfo] = useState<Record<string, AutoCategoryInfo>>({})
  const [summaries, setSummaries] = useState<Record<string, SymbolEntry[]>>({})
  const [isRunning, setIsRunning] = useState(false)
  const [nextRunAt, setNextRunAt] = useState<number | null>(null)
  const [, setTick] = useState(0)  // triggers 1-second re-renders for countdowns
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [notifyStatus, setNotifyStatus] = useState<'idle' | 'sending' | 'ok' | 'error'>('idle')
  const [notifyError, setNotifyError] = useState('')

  useEffect(() => {
    const t = setInterval(() => setTick(v => v + 1), 1000)
    return () => clearInterval(t)
  }, [])

  const loadAll = async () => {
    try {
      const data = await fetchAutoLatest()
      setAutoInfo(data.categories || {})
      setIsRunning(data.is_running)
      setNextRunAt(data.next_run_at)

      for (const cat of Object.keys(data.categories || {})) {
        const info = data.categories[cat]
        if (!info?.batch_id) continue
        try {
          const { data: summary } = await client.get(
            `/batch/${info.batch_id}/symbol-summary`,
            { params: { min_trades: 10, min_win_rate: 0.55 } },
          )
          setSummaries(prev => ({ ...prev, [cat]: summary.symbols || [] }))
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  }

  useEffect(() => {
    loadAll()
    pollRef.current = setInterval(loadAll, 15000)
    return () => clearInterval(pollRef.current!)
  }, [])

  const handleNotifyTest = async () => {
    setNotifyStatus('sending')
    setNotifyError('')
    try {
      const res = await sendNotifyTest()
      if (res.ok) {
        setNotifyStatus('ok')
      } else {
        setNotifyStatus('error')
        setNotifyError(res.error ?? '不明なエラー')
      }
    } catch (e: unknown) {
      setNotifyStatus('error')
      setNotifyError(e instanceof Error ? e.message : '通信エラー')
    }
    setTimeout(() => setNotifyStatus('idle'), 4000)
  }

  const catInfo = autoInfo[activeCategory]
  const symbols: SymbolEntry[] = summaries[activeCategory] || []

  const getEvPerTrade = (top: TopStrategy, symbolDisplay: string): number | null => {
    const pr = parseFloat(payoutRates[symbolDisplay] ?? '')
    if (!isNaN(pr) && pr > 0 && pr <= 100) return top.win_rate * (pr / 100) - (1 - top.win_rate)
    if (top.expected_value != null && top.total_trades > 0) return top.expected_value / top.total_trades
    return null
  }

  const getConsEv = (top: TopStrategy, symbolDisplay: string): number | null => {
    const ev = getEvPerTrade(top, symbolDisplay)
    const fd = computeFixedDiscount(top.win_rate, top.total_trades)
    return ev != null && fd != null ? ev - fd : null
  }

  // Sort by conservative EV (実効EV), using hourly_ev as tiebreaker for timeframe fairness
  const sorted = [...symbols].sort((a, b) => {
    const topA = a.top_strategy
    const topB = b.top_strategy
    const keyA = topA ? (getConsEv(topA, a.symbol_display) ?? topA.hourly_ev ?? -999) : -999
    const keyB = topB ? (getConsEv(topB, b.symbol_display) ?? topB.hourly_ev ?? -999) : -999
    return keyB - keyA
  })

  const hasResults = sorted.some(s => s.top_strategy != null)

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', paddingBottom: '80px' }}>
      {/* Header */}
      <div style={{ padding: '20px 16px 12px', borderBottom: '1px solid #1e293b' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '20px', fontWeight: '700', color: '#f1f5f9' }}>
              最新シグナル
            </h1>
            <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#475569' }}>
              30分ごとに自動分析
            </p>
          </div>
          <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
            {isRunning ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <div style={{
                  width: '7px', height: '7px', borderRadius: '50%',
                  background: '#a78bfa', boxShadow: '0 0 6px #a78bfa',
                }} />
                <span style={{ fontSize: '12px', color: '#a78bfa', fontWeight: '600' }}>分析中...</span>
              </div>
            ) : catInfo ? (
              <div>
                <div style={{ fontSize: '11px', color: '#64748b' }}>
                  最終更新: {timeAgo(catInfo.created_at)}
                </div>
                {nextRunAt && (
                  <div style={{ fontSize: '11px', color: '#475569' }}>
                    次回: {timeUntil(nextRunAt)}
                  </div>
                )}
              </div>
            ) : null}

            {/* Discord test button */}
            <button
              onClick={handleNotifyTest}
              disabled={notifyStatus === 'sending'}
              style={{
                padding: '4px 10px', borderRadius: '6px', border: '1px solid',
                borderColor: notifyStatus === 'ok' ? '#16a34a' : notifyStatus === 'error' ? '#dc2626' : '#334155',
                background: notifyStatus === 'ok' ? '#052e16' : notifyStatus === 'error' ? '#1e0a0a' : '#1e293b',
                color: notifyStatus === 'ok' ? '#4ade80' : notifyStatus === 'error' ? '#f87171' : '#94a3b8',
                fontSize: '11px', fontWeight: '600', cursor: notifyStatus === 'sending' ? 'default' : 'pointer',
                transition: 'all 0.2s',
              }}
            >
              {notifyStatus === 'sending' ? '送信中...' : notifyStatus === 'ok' ? '✓ 送信成功' : notifyStatus === 'error' ? '✗ 失敗' : '🔔 通知テスト'}
            </button>
            {notifyStatus === 'error' && notifyError && (
              <div style={{ fontSize: '10px', color: '#f87171', maxWidth: '160px', textAlign: 'right' }}>
                {notifyError}
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={{ padding: '16px', maxWidth: '480px', margin: '0 auto' }}>

        {/* Category tabs */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
          {CATEGORIES.map(cat => (
            <button
              key={cat.key}
              onClick={() => setActiveCategory(cat.key)}
              style={{
                flex: 1, padding: '8px', borderRadius: '8px', border: 'none',
                background: activeCategory === cat.key ? '#3b82f6' : '#1e293b',
                color: activeCategory === cat.key ? '#fff' : '#94a3b8',
                fontSize: '13px', fontWeight: '700', cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* First-run waiting state */}
        {!catInfo && !isRunning && (
          <div style={{ textAlign: 'center', padding: '60px 20px' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>⏳</div>
            <div style={{ fontSize: '15px', color: '#64748b', fontWeight: '600' }}>初回分析を準備中</div>
            <div style={{ fontSize: '12px', color: '#475569', marginTop: '8px' }}>
              サーバー起動後に自動で分析が始まります
            </div>
          </div>
        )}

        {isRunning && !hasResults && (
          <div style={{ textAlign: 'center', padding: '60px 20px' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>🔄</div>
            <div style={{ fontSize: '15px', color: '#a78bfa', fontWeight: '600' }}>分析中...</div>
            <div style={{ fontSize: '12px', color: '#475569', marginTop: '8px' }}>
              最初の分析は数分かかります
            </div>
          </div>
        )}

        {/* Results leaderboard */}
        {sorted.map((sym, idx) => {
          const top = sym.top_strategy
          const evPerTrade = top ? getEvPerTrade(top, sym.symbol_display) : null
          const fixedDiscount = top ? computeFixedDiscount(top.win_rate, top.total_trades) : null
          const consEv = fixedDiscount != null && evPerTrade != null ? evPerTrade - fixedDiscount : null
          const recommended = top != null && top.total_trades >= 30 && evPerTrade != null && evPerTrade >= 0.07
          const prVal = payoutRates[sym.symbol_display] ?? ''
          const validPr = !isNaN(parseFloat(prVal)) && parseFloat(prVal) > 0

          return (
            <div
              key={sym.symbol}
              style={{
                background: recommended ? '#050f07' : '#0a0f1e',
                borderRadius: '12px',
                border: `1px solid ${recommended ? '#16a34a' : (top?.win_rate ?? 0) >= 0.55 ? '#1d3461' : '#1e293b'}`,
                marginBottom: '10px',
                overflow: 'hidden',
              }}
            >
              <div style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                {/* Rank */}
                <div style={{
                  width: '28px', height: '28px', borderRadius: '50%', flexShrink: 0,
                  background: idx === 0 ? '#f59e0b' : idx === 1 ? '#94a3b8' : idx === 2 ? '#b45309' : '#1e293b',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '12px', fontWeight: '800', color: idx < 3 ? '#000' : '#475569',
                }}>
                  {idx + 1}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{ fontSize: '15px', fontWeight: '700', color: '#e2e8f0' }}>
                      {sym.symbol_display}
                    </div>
                    {recommended && (
                      <span style={{
                        flexShrink: 0, background: '#0a1f0a', color: '#4ade80',
                        fontSize: '9px', fontWeight: '800', padding: '2px 6px',
                        borderRadius: '4px', border: '1px solid #16a34a',
                      }}>
                        ◆ 推奨
                      </span>
                    )}
                  </div>

                  {top ? (
                    <div style={{
                      fontSize: '12px', color: '#64748b', marginTop: '2px',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {TF_LABEL[top.timeframe]} / {top.trade_duration}分取引 / {top.strategy_name}
                    </div>
                  ) : (
                    <div style={{ fontSize: '12px', color: '#334155', marginTop: '2px' }}>
                      条件に合う結果なし
                    </div>
                  )}

                  {(evPerTrade != null || consEv != null) && (
                    <div style={{ display: 'flex', gap: '5px', marginTop: '4px', flexWrap: 'wrap' }}>
                      {evPerTrade != null && (
                        <span style={{ background: '#1a0e2e', color: '#c4b5fd', fontSize: '10px', fontWeight: '700', padding: '1px 6px', borderRadius: '4px', border: '1px solid #6d28d9' }}>
                          1回 {evPerTrade >= 0 ? '+' : ''}{evPerTrade.toFixed(3)}
                        </span>
                      )}
                      {top?.hourly_ev != null && (
                        <span style={{ background: '#0f2a1a', color: '#4ade80', fontSize: '10px', fontWeight: '700', padding: '1px 6px', borderRadius: '4px', border: '1px solid #166534' }}>
                          毎時 {top.hourly_ev.toFixed(2)}
                        </span>
                      )}
                      {consEv != null && (
                        <span style={{ background: '#1c1000', color: consEv >= 0 ? '#fbbf24' : '#f97316', fontSize: '10px', fontWeight: '700', padding: '1px 6px', borderRadius: '4px', border: `1px solid ${consEv >= 0 ? '#92400e' : '#7c2d12'}` }}>
                          実効 {consEv >= 0 ? '+' : ''}{consEv.toFixed(3)}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Per-symbol payout input */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '6px' }}>
                    <span style={{ fontSize: '10px', color: '#475569' }}>PO</span>
                    <input
                      type="number" min={1} max={99} placeholder="—"
                      value={prVal}
                      onChange={e => setPayoutRate(sym.symbol_display, e.target.value)}
                      style={{
                        width: '34px', background: 'none', border: 'none',
                        borderBottom: `1px solid ${validPr ? '#6d28d9' : '#334155'}`,
                        color: validPr ? '#c4b5fd' : '#64748b',
                        fontSize: '11px', fontWeight: '700', padding: '0 2px',
                        outline: 'none', textAlign: 'center',
                      }}
                    />
                    <span style={{ fontSize: '10px', color: '#475569' }}>%</span>
                  </div>
                </div>

                {top ? (
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: '20px', fontWeight: '800', color: winColor(top.win_rate) }}>
                      {Math.round(top.win_rate * 100)}%
                    </div>
                    <div style={{ fontSize: '11px', color: '#475569' }}>{top.total_trades}回</div>
                  </div>
                ) : (
                  <div style={{ fontSize: '12px', color: '#334155' }}>—</div>
                )}
              </div>

              {top && (
                <>
                  <div style={{ height: '3px', background: '#1e293b' }}>
                    <div style={{
                      height: '100%',
                      width: `${Math.min(top.win_rate * 100, 100)}%`,
                      background: winColor(top.win_rate),
                    }} />
                  </div>
                  <button
                    onClick={() => navigate(`/results/${top.sim_id}/chart/${top.id}`)}
                    style={{
                      width: '100%', padding: '8px', background: 'none', border: 'none',
                      borderTop: '1px solid #1e293b', color: '#3b82f6',
                      fontSize: '12px', cursor: 'pointer', textAlign: 'center',
                    }}
                  >
                    詳細チャートを見る →
                  </button>
                </>
              )}
            </div>
          )
        })}

        {/* Full results link */}
        {catInfo && hasResults && (
          <button
            onClick={() => navigate(`/category-results/${catInfo.batch_id}`)}
            style={{
              width: '100%', padding: '12px', borderRadius: '10px',
              border: '1px solid #334155', background: 'none',
              color: '#3b82f6', fontSize: '13px', fontWeight: '600',
              cursor: 'pointer', marginTop: '4px',
            }}
          >
            全ストラテジーを見る →
          </button>
        )}
      </div>
    </div>
  )
}
