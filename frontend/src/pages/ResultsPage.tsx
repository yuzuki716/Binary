import { useEffect, useState, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../store/useStore'
import { fetchResults, getSimulation } from '../api'
import type { StrategyResult, SimulationStatus } from '../types'
import { computeFixedDiscount } from '../utils/ev'
import WinRateBadge from '../components/common/WinRateBadge'

const FAMILY_LABELS: Record<string, string> = {
  SMA_CROSS: 'SMA', EMA_CROSS: 'EMA', RSI: 'RSI',
  MACD: 'MACD', BB: 'BB', STOCH: 'Stoch',
  RSI_MA: 'RSI+MA', MACD_BB: 'MACD+BB',
}

export default function ResultsPage() {
  const { simId } = useParams<{ simId: string }>()
  const navigate = useNavigate()
  const { setSelectedStrategy, payoutRates, setPayoutRate } = useStore()

  const [sim, setSim] = useState<SimulationStatus | null>(null)
  const [results, setResults] = useState<StrategyResult[]>([])
  const [total, setTotal] = useState(0)
  const [filtered, setFiltered] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [minTrades, setMinTrades] = useState(10)
  const [minWinRate, setMinWinRate] = useState(55)
  const [sort, setSort] = useState('expected_value')

  const load = useCallback(async (p = 1) => {
    if (!simId) return
    setLoading(true)
    try {
      const [simData, resData] = await Promise.all([
        getSimulation(simId),
        fetchResults(simId, { page: p, min_trades: minTrades, min_win_rate: minWinRate / 100, sort })
      ])
      setSim(simData)
      setResults(p === 1 ? resData.results : (prev) => [...prev, ...resData.results])
      setTotal(resData.total)
      setFiltered(resData.filtered)
      setPage(p)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [simId, minTrades, minWinRate, sort])

  useEffect(() => {
    load(1)
  }, [load])

  const payoutRate = payoutRates[sim?.symbol_display ?? ''] ?? ''
  const pr = parseFloat(payoutRate)
  const validPayout = !isNaN(pr) && pr > 0 && pr <= 100

  const handleStrategyClick = (s: StrategyResult) => {
    setSelectedStrategy(s)
    navigate(`/results/${simId}/chart/${s.id}`)
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', paddingBottom: '80px' }}>
      {/* Header */}
      <div style={{ padding: '16px', background: '#1e293b', borderBottom: '1px solid #334155', position: 'sticky', top: 0, zIndex: 40 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', color: '#3b82f6', fontSize: '14px', cursor: 'pointer', padding: 0 }}>
            ← 新規
          </button>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '14px', fontWeight: '700', color: '#f1f5f9' }}>
              {sim?.symbol_display} / {sim?.timeframe}
            </div>
            <div style={{ fontSize: '11px', color: '#64748b' }}>
              {filtered}/{total} ストラテジー
            </div>
          </div>
          <div style={{ width: '40px' }} />
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: '8px', marginTop: '10px', overflowX: 'auto', paddingBottom: '4px' }}>
          <FilterChip
            label={`最低 ${minTrades} 回`}
            onInc={() => { setMinTrades(v => Math.min(v + 10, 100)); setPage(1) }}
            onDec={() => { setMinTrades(v => Math.max(v - 10, 0)); setPage(1) }}
          />
          <FilterChip
            label={`勝率 ${minWinRate}%+`}
            onInc={() => { setMinWinRate(v => Math.min(v + 5, 80)); setPage(1) }}
            onDec={() => { setMinWinRate(v => Math.max(v - 5, 0)); setPage(1) }}
          />
          <select
            value={sort}
            onChange={(e) => { setSort(e.target.value); setPage(1) }}
            style={{
              background: '#0f172a', border: '1px solid #334155',
              color: '#94a3b8', borderRadius: '16px',
              padding: '4px 10px', fontSize: '12px', cursor: 'pointer',
            }}
          >
            <option value="expected_value">期待値順</option>
            <option value="win_rate">勝率順</option>
            <option value="total_trades">取引数順</option>
            <option value="profit_factor">PF順</option>
          </select>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: '#0f172a', border: `1px solid ${validPayout ? '#6d28d9' : '#334155'}`, borderRadius: '16px', padding: '3px 8px', whiteSpace: 'nowrap', flexShrink: 0 }}>
            <span style={{ fontSize: '11px', color: '#64748b' }}>PO</span>
            <input
              type="number" min={1} max={99} placeholder="—"
              value={payoutRate}
              onChange={e => setPayoutRate(sim?.symbol_display ?? '', e.target.value)}
              style={{ width: '36px', background: 'none', border: 'none', color: validPayout ? '#c4b5fd' : '#94a3b8', fontSize: '12px', fontWeight: '700', padding: 0, outline: 'none', textAlign: 'center' }}
            />
            <span style={{ fontSize: '11px', color: '#64748b' }}>%</span>
          </div>
        </div>
      </div>

      {/* Results list */}
      <div style={{ padding: '8px 12px' }}>
        {(validPayout
          ? [...results].sort((a, b) => {
              const evA = a.win_rate * (pr / 100) - (1 - a.win_rate)
              const evB = b.win_rate * (pr / 100) - (1 - b.win_rate)
              return evB - evA
            })
          : results
        ).map((r, idx) => (
          <StrategyCard key={r.id} strategy={r} onClick={() => handleStrategyClick(r)} payoutRate={validPayout ? pr : null} overrideRank={validPayout ? idx + 1 : undefined} />
        ))}

        {loading && (
          <div style={{ textAlign: 'center', padding: '20px', color: '#64748b', fontSize: '13px' }}>
            読み込み中...
          </div>
        )}

        {!loading && results.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: '#64748b' }}>
            <div style={{ fontSize: '40px', marginBottom: '12px' }}>📭</div>
            <div>条件に合うストラテジーがありません</div>
            <div style={{ fontSize: '12px', marginTop: '4px' }}>フィルターを緩めてください</div>
          </div>
        )}

        {!loading && results.length < filtered && (
          <button
            onClick={() => load(page + 1)}
            style={{
              width: '100%', padding: '12px',
              borderRadius: '10px', border: '1px solid #334155',
              background: 'none', color: '#3b82f6', fontSize: '14px',
              cursor: 'pointer', marginTop: '8px',
            }}
          >
            さらに読み込む ({results.length}/{filtered})
          </button>
        )}
      </div>
    </div>
  )
}

function StrategyCard({ strategy: s, onClick, payoutRate, overrideRank }: { strategy: StrategyResult; onClick: () => void; payoutRate: number | null; overrideRank?: number }) {
  const pf = s.profit_factor ? s.profit_factor.toFixed(2) : '-'
  const familyLabel = FAMILY_LABELS[s.indicator_family] || s.indicator_family
  const evPerTrade = payoutRate != null
    ? s.win_rate * (payoutRate / 100) - (1 - s.win_rate)
    : s.expected_value != null && s.total_trades > 0 ? s.expected_value / s.total_trades : null
  const fixedDiscount = computeFixedDiscount(s.win_rate, s.total_trades)
  const consEv = fixedDiscount != null && evPerTrade != null ? evPerTrade - fixedDiscount : null
  const recommended = s.total_trades >= 30 && evPerTrade != null && evPerTrade >= 0.07

  return (
    <div
      onClick={onClick}
      style={{
        background: recommended ? '#0a1a0f' : '#1e293b',
        borderRadius: '12px',
        padding: '14px',
        marginBottom: '8px',
        cursor: 'pointer',
        border: `1px solid ${recommended ? '#16a34a' : '#334155'}`,
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        transition: 'background 0.15s',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      {/* Rank */}
      <div style={{ fontSize: '16px', fontWeight: '700', color: '#475569', minWidth: '28px', textAlign: 'right' }}>
        {overrideRank != null ? `#${overrideRank}` : s.rank ? `#${s.rank}` : '—'}
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
          <div style={{ fontSize: '14px', fontWeight: '600', color: '#f1f5f9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {s.strategy_name}
          </div>
          {recommended && (
            <span style={{ flexShrink: 0, background: '#0a1f0a', color: '#4ade80', fontSize: '9px', fontWeight: '800', padding: '2px 6px', borderRadius: '4px', border: '1px solid #16a34a', letterSpacing: '0.03em' }}>
              ◆ 推奨
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span style={{
            background: '#0f172a', color: '#64748b',
            borderRadius: '4px', padding: '1px 6px', fontSize: '10px', fontWeight: '600'
          }}>
            {familyLabel}
          </span>
          <span style={{ fontSize: '12px', color: '#64748b' }}>
            {s.total_trades}回 · PF {pf}
          </span>
        </div>
        {/* EV badges */}
        <div style={{ display: 'flex', gap: '5px', marginTop: '4px', flexWrap: 'wrap' }}>
          {evPerTrade != null && (
            <span style={{ background: '#1a0e2e', color: '#c4b5fd', fontSize: '10px', fontWeight: '700', padding: '1px 6px', borderRadius: '4px', border: '1px solid #6d28d9' }}>
              1回 {evPerTrade >= 0 ? '+' : ''}{evPerTrade.toFixed(3)}
            </span>
          )}
          {s.hourly_ev != null && (
            <span style={{ background: '#0f2a1a', color: '#4ade80', fontSize: '10px', fontWeight: '700', padding: '1px 6px', borderRadius: '4px', border: '1px solid #166534' }}>
              毎時 {s.hourly_ev.toFixed(2)}
            </span>
          )}
          {consEv != null && (
            <span style={{ background: '#1c1000', color: consEv >= 0 ? '#fbbf24' : '#f97316', fontSize: '10px', fontWeight: '700', padding: '1px 6px', borderRadius: '4px', border: `1px solid ${consEv >= 0 ? '#92400e' : '#7c2d12'}` }}>
              実効 {consEv >= 0 ? '+' : ''}{consEv.toFixed(3)}
            </span>
          )}
        </div>
      </div>

      {/* Win rate */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
        <WinRateBadge winRate={s.win_rate} />
        <span style={{ fontSize: '11px', color: '#475569' }}>›</span>
      </div>
    </div>
  )
}

function FilterChip({
  label, onInc, onDec
}: { label: string; onInc: () => void; onDec: () => void }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '4px',
      background: '#0f172a', border: '1px solid #334155',
      borderRadius: '16px', padding: '3px 4px',
      whiteSpace: 'nowrap', flexShrink: 0,
    }}>
      <button onClick={onDec} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: '2px 4px', fontSize: '14px' }}>−</button>
      <span style={{ fontSize: '12px', color: '#94a3b8', padding: '0 2px' }}>{label}</span>
      <button onClick={onInc} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: '2px 4px', fontSize: '14px' }}>+</button>
    </div>
  )
}
