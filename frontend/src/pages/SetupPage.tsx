import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore'
import { fetchSymbols, createSimulation, createBatch } from '../api'
import client from '../api/client'
import type { SymbolInfo } from '../types'
import { INDICATOR_FAMILIES, TIMEFRAMES } from '../types'

const CATEGORY_LABELS: Record<string, string> = {
  forex: '為替',
  crypto: '暗号資産',
  indices: '指数',
}

export default function SetupPage() {
  const navigate = useNavigate()
  const {
    symbol, symbolDisplay, timeframe, tradeDuration,
    selectedIndicators, barLimit,
    setSymbol, setTimeframe, setTradeDuration,
    toggleIndicator, setAllIndicators, setBarLimit,
    setCurrentSim,
  } = useStore()

  const [symbols, setSymbols] = useState<Record<string, SymbolInfo[]>>({})
  const [activeCategory, setActiveCategory] = useState<string>('crypto')
  const [loading, setLoading] = useState(false)
  const [batchLoading, setBatchLoading] = useState(false)
  const [groupLoading, setGroupLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchSymbols().then((data) => {
      setSymbols({
        crypto: data.crypto,
        forex: data.forex,
        indices: data.indices,
      })
    }).catch(() => {})
  }, [])

  const estimatedStrategies = selectedIndicators.reduce((acc, key) => {
    const counts: Record<string, number> = {
      SMA_CROSS: 12, EMA_CROSS: 10, RSI: 16, MACD: 6, BB: 9, STOCH: 6, RSI_MA: 4, MACD_BB: 3
    }
    return acc + (counts[key] || 5)
  }, 0)

  const handleGroupRun = async () => {
    if (selectedIndicators.length === 0) return
    setGroupLoading(true)
    setError(null)
    try {
      const { data } = await client.post('/category-batch', {
        symbol: '',
        symbol_display: CATEGORY_LABELS[activeCategory],
        indicators: selectedIndicators,
        bar_limit: barLimit,
      }, { params: { category: activeCategory } })
      navigate(`/category-progress/${data.batch_id}`)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setGroupLoading(false)
    }
  }

  const handleBatchRun = async () => {
    if (!symbol || selectedIndicators.length === 0) return
    setBatchLoading(true)
    setError(null)
    try {
      const res = await createBatch({
        symbol,
        symbol_display: symbolDisplay,
        indicators: selectedIndicators,
        bar_limit: barLimit,
      })
      navigate(`/batch-progress/${res.batch_id}`)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBatchLoading(false)
    }
  }

  const handleRun = async () => {
    if (!symbol || selectedIndicators.length === 0) return
    setLoading(true)
    setError(null)
    try {
      const sim = await createSimulation({
        symbol,
        symbol_display: symbolDisplay,
        timeframe,
        trade_duration: tradeDuration,
        indicators: selectedIndicators,
        bar_limit: barLimit,
      })
      setCurrentSim(sim)
      navigate(`/progress/${sim.id}`)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', paddingBottom: '80px' }}>
      {/* Header */}
      <div style={{
        padding: '20px 16px 12px',
        borderBottom: '1px solid #1e293b',
      }}>
        <h1 style={{ margin: 0, fontSize: '20px', fontWeight: '700', color: '#f1f5f9' }}>
          バイナリーオプション
        </h1>
        <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>
          自動シミュレーター
        </p>
      </div>

      <div style={{ padding: '16px', maxWidth: '480px', margin: '0 auto' }}>
        {/* Symbol Section */}
        <Section title="銘柄">
          {/* Category tabs + group analysis button */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
            {Object.keys(CATEGORY_LABELS).map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                style={{
                  flex: 1,
                  padding: '6px',
                  borderRadius: '8px',
                  border: 'none',
                  background: activeCategory === cat ? '#3b82f6' : '#1e293b',
                  color: activeCategory === cat ? '#fff' : '#94a3b8',
                  fontSize: '12px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                {CATEGORY_LABELS[cat]}
              </button>
            ))}
          </div>

          {/* Group batch button */}
          <button
            onClick={handleGroupRun}
            disabled={groupLoading || selectedIndicators.length === 0}
            style={{
              width: '100%', padding: '9px',
              borderRadius: '8px', border: '1px dashed #4c1d95',
              background: groupLoading ? '#1e293b' : '#1e0a3a',
              color: groupLoading ? '#475569' : '#a78bfa',
              fontSize: '12px', fontWeight: '600',
              cursor: groupLoading || selectedIndicators.length === 0 ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s',
              marginBottom: '12px',
            }}
          >
            {groupLoading
              ? '起動中...'
              : `🔮 ${CATEGORY_LABELS[activeCategory]}の全銘柄を一括分析`}
          </button>

          {/* Symbol grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
            {(symbols[activeCategory] || []).map((s) => (
              <button
                key={s.key}
                onClick={() => setSymbol(s.key, s.display)}
                style={{
                  padding: '10px 4px',
                  borderRadius: '10px',
                  border: symbol === s.key ? '2px solid #3b82f6' : '2px solid #334155',
                  background: symbol === s.key ? '#1d3461' : '#1e293b',
                  color: symbol === s.key ? '#93c5fd' : '#e2e8f0',
                  fontSize: '13px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  textAlign: 'center',
                  transition: 'all 0.15s',
                }}
              >
                {s.display}
              </button>
            ))}
          </div>
        </Section>

        {/* Timeframe Section */}
        <Section title="分析時間足">
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf.value}
                onClick={() => setTimeframe(tf.value)}
                style={{
                  padding: '8px 14px',
                  borderRadius: '8px',
                  border: 'none',
                  background: timeframe === tf.value ? '#3b82f6' : '#1e293b',
                  color: timeframe === tf.value ? '#fff' : '#94a3b8',
                  fontSize: '13px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                  minWidth: '52px',
                }}
              >
                {tf.label}
              </button>
            ))}
          </div>
        </Section>

        {/* Trade Duration */}
        <Section title="取引時間">
          <div style={{ display: 'flex', gap: '12px' }}>
            {[1, 5].map((d) => (
              <button
                key={d}
                onClick={() => setTradeDuration(d)}
                style={{
                  flex: 1,
                  padding: '12px',
                  borderRadius: '10px',
                  border: tradeDuration === d ? '2px solid #3b82f6' : '2px solid #334155',
                  background: tradeDuration === d ? '#1d3461' : '#1e293b',
                  color: tradeDuration === d ? '#93c5fd' : '#e2e8f0',
                  fontSize: '15px',
                  fontWeight: '700',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                {d}分
                <div style={{ fontSize: '11px', fontWeight: '400', color: '#64748b', marginTop: '2px' }}>
                  {d === 1 ? '次の1本で判定' : '5本後で判定'}
                </div>
              </button>
            ))}
          </div>
        </Section>

        {/* Data bars */}
        <Section title="データ本数">
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {[500, 1000, 2000, 3000].map((n) => (
              <button
                key={n}
                onClick={() => setBarLimit(n)}
                style={{
                  padding: '8px 14px',
                  borderRadius: '8px',
                  border: 'none',
                  background: barLimit === n ? '#3b82f6' : '#1e293b',
                  color: barLimit === n ? '#fff' : '#94a3b8',
                  fontSize: '13px',
                  fontWeight: '600',
                  cursor: 'pointer',
                }}
              >
                {n.toLocaleString()}本
              </button>
            ))}
          </div>
        </Section>

        {/* Indicators */}
        <Section title="インジケーター">
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' }}>
            <button
              onClick={() => setAllIndicators(INDICATOR_FAMILIES.map((f) => f.key))}
              style={{ background: 'none', border: 'none', color: '#3b82f6', fontSize: '12px', cursor: 'pointer', padding: '0' }}
            >
              全選択
            </button>
            <span style={{ color: '#334155', margin: '0 6px' }}>|</span>
            <button
              onClick={() => setAllIndicators([])}
              style={{ background: 'none', border: 'none', color: '#64748b', fontSize: '12px', cursor: 'pointer', padding: '0' }}
            >
              全解除
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {INDICATOR_FAMILIES.map((fam) => {
              const on = selectedIndicators.includes(fam.key)
              return (
                <label
                  key={fam.key}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '10px 12px',
                    borderRadius: '10px',
                    background: on ? '#1d3461' : '#1e293b',
                    border: `1px solid ${on ? '#3b82f6' : '#334155'}`,
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggleIndicator(fam.key)}
                    style={{ width: '18px', height: '18px', accentColor: '#3b82f6', cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: '14px', color: on ? '#e2e8f0' : '#94a3b8', fontWeight: on ? '600' : '400' }}>
                    {fam.label}
                  </span>
                </label>
              )
            })}
          </div>
          <p style={{ margin: '10px 0 0', fontSize: '12px', color: '#64748b' }}>
            約 <strong style={{ color: '#94a3b8' }}>{estimatedStrategies}</strong> パターンをテストします
          </p>
        </Section>

        {error && (
          <div style={{
            padding: '12px', borderRadius: '8px',
            background: '#1e0a0a', border: '1px solid #ef4444',
            color: '#fca5a5', fontSize: '13px', marginBottom: '16px',
          }}>
            {error}
          </div>
        )}

        {/* Batch run button */}
        <button
          onClick={handleBatchRun}
          disabled={batchLoading || loading || selectedIndicators.length === 0}
          style={{
            width: '100%',
            padding: '16px',
            borderRadius: '12px',
            border: 'none',
            background: batchLoading || selectedIndicators.length === 0 ? '#334155' : '#7c3aed',
            color: '#fff',
            fontSize: '16px',
            fontWeight: '700',
            cursor: batchLoading || selectedIndicators.length === 0 ? 'not-allowed' : 'pointer',
            transition: 'background 0.15s',
            marginBottom: '10px',
          }}
        >
          {batchLoading ? '起動中...' : '⚡ 一括分析（全時間足 × 全取引時間）'}
        </button>

        {/* Single run button */}
        <button
          onClick={handleRun}
          disabled={loading || batchLoading || selectedIndicators.length === 0}
          style={{
            width: '100%',
            padding: '14px',
            borderRadius: '12px',
            border: '1px solid #334155',
            background: 'none',
            color: loading || selectedIndicators.length === 0 ? '#334155' : '#94a3b8',
            fontSize: '14px',
            fontWeight: '600',
            cursor: loading || selectedIndicators.length === 0 ? 'not-allowed' : 'pointer',
            transition: 'all 0.15s',
            marginBottom: '8px',
          }}
        >
          {loading ? '起動中...' : `▶ 個別実行（${TIMEFRAMES.find(t => t.value === timeframe)?.label} / ${tradeDuration}分取引）`}
        </button>
        <p style={{ textAlign: 'center', fontSize: '12px', color: '#475569', margin: 0 }}>
          一括分析: 1m・5m・15m・1h × 1分・5分取引 を同時分析
        </p>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '20px' }}>
      <h2 style={{
        margin: '0 0 10px',
        fontSize: '13px',
        fontWeight: '600',
        color: '#64748b',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
      }}>
        {title}
      </h2>
      {children}
    </div>
  )
}
