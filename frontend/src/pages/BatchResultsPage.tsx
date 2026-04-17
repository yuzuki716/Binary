import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getBatchResults } from '../api'
import type { BatchResultItem, BatchResultsResponse } from '../types'

const TF_LABELS: Record<string, string> = { '1m': '1分足', '5m': '5分足', '15m': '15分足', '1h': '1時間足' }
const BATCH_TFS = ['1m', '5m', '15m', '1h']

function winRateColor(rate: number): string {
  if (rate >= 0.6) return '#22c55e'
  if (rate >= 0.55) return '#84cc16'
  if (rate >= 0.5) return '#eab308'
  return '#ef4444'
}

function WinRateBar({ rate }: { rate: number }) {
  return (
    <div style={{ height: '4px', borderRadius: '2px', background: '#1e293b', overflow: 'hidden', marginTop: '4px' }}>
      <div style={{
        height: '100%',
        width: `${Math.min(rate * 100, 100)}%`,
        background: winRateColor(rate),
        transition: 'width 0.3s',
      }} />
    </div>
  )
}

function StrategyCard({ item, onClick }: { item: BatchResultItem; onClick: () => void }) {
  const pct = Math.round(item.win_rate * 100)
  let params: Record<string, any> = {}
  try { params = JSON.parse(item.parameters) } catch { /* noop */ }
  const paramStr = Object.entries(params).map(([k, v]) => `${k}:${v}`).join(' ')

  return (
    <button
      onClick={onClick}
      style={{
        width: '100%', textAlign: 'left', padding: '12px',
        background: '#0a0f1e', borderRadius: '10px',
        border: '1px solid #1e293b', cursor: 'pointer',
        transition: 'border-color 0.15s',
        marginBottom: '8px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '13px', fontWeight: '700', color: '#e2e8f0', marginBottom: '2px' }}>
            {item.strategy_name}
          </div>
          <div style={{ fontSize: '11px', color: '#475569', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {paramStr}
          </div>
        </div>
        <div style={{ textAlign: 'right', marginLeft: '12px', flexShrink: 0 }}>
          <div style={{ fontSize: '20px', fontWeight: '800', color: winRateColor(item.win_rate) }}>
            {pct}%
          </div>
          <div style={{ fontSize: '11px', color: '#475569' }}>
            {item.total_trades}回
          </div>
        </div>
      </div>
      <WinRateBar rate={item.win_rate} />
    </button>
  )
}

export default function BatchResultsPage() {
  const { batchId } = useParams<{ batchId: string }>()
  const navigate = useNavigate()
  const [data, setData] = useState<BatchResultsResponse | null>(null)
  const [activeTf, setActiveTf] = useState('1m')
  const [minTrades, setMinTrades] = useState(10)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!batchId) return
    setLoading(true)
    getBatchResults(batchId, minTrades)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [batchId, minTrades])

  const tfResults = data?.results_by_tf[activeTf] || {}
  const dur1 = tfResults['1'] || []
  const dur5 = tfResults['5'] || []

  const handleStrategyClick = (item: BatchResultItem) => {
    navigate(`/results/${item.sim_id}/chart/${item.id}`)
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', paddingBottom: '80px' }}>
      {/* Header */}
      <div style={{ padding: '20px 16px 12px', borderBottom: '1px solid #1e293b' }}>
        <button
          onClick={() => navigate('/')}
          style={{ background: 'none', border: 'none', color: '#64748b', fontSize: '13px', cursor: 'pointer', padding: 0, marginBottom: '8px' }}
        >
          ← 設定に戻る
        </button>
        <h1 style={{ margin: 0, fontSize: '18px', fontWeight: '700', color: '#f1f5f9' }}>
          一括分析結果
        </h1>
        {data && (
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>
            {data.symbol_display} — 全時間足 × 全取引時間
          </p>
        )}
      </div>

      <div style={{ padding: '16px', maxWidth: '480px', margin: '0 auto' }}>
        {/* Timeframe tabs */}
        <div style={{ display: 'flex', gap: '6px', marginBottom: '16px' }}>
          {BATCH_TFS.map((tf) => {
            const tfData = data?.results_by_tf[tf]
            const hasData = tfData && (tfData['1']?.length || tfData['5']?.length)
            return (
              <button
                key={tf}
                onClick={() => setActiveTf(tf)}
                style={{
                  flex: 1, padding: '8px 4px',
                  borderRadius: '8px', border: 'none',
                  background: activeTf === tf ? '#3b82f6' : '#1e293b',
                  color: activeTf === tf ? '#fff' : hasData ? '#94a3b8' : '#334155',
                  fontSize: '13px', fontWeight: '700', cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                {TF_LABELS[tf].replace('足', '')}
              </button>
            )
          })}
        </div>

        {/* Min trades filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
          <span style={{ fontSize: '12px', color: '#64748b', whiteSpace: 'nowrap' }}>最低取引数</span>
          {[5, 10, 20, 30].map((n) => (
            <button
              key={n}
              onClick={() => setMinTrades(n)}
              style={{
                padding: '4px 10px', borderRadius: '6px', border: 'none',
                background: minTrades === n ? '#3b82f6' : '#1e293b',
                color: minTrades === n ? '#fff' : '#64748b',
                fontSize: '12px', cursor: 'pointer',
              }}
            >
              {n}+
            </button>
          ))}
        </div>

        {loading && (
          <div style={{ textAlign: 'center', padding: '40px', color: '#475569' }}>読み込み中...</div>
        )}

        {error && (
          <div style={{
            padding: '12px', borderRadius: '8px',
            background: '#1e0a0a', border: '1px solid #ef4444',
            color: '#fca5a5', fontSize: '13px', marginBottom: '16px',
          }}>
            エラー: {error}
          </div>
        )}

        {!loading && data && (
          <>
            {/* 1分取引 section */}
            <div style={{ marginBottom: '24px' }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                marginBottom: '12px', paddingBottom: '8px',
                borderBottom: '1px solid #1e293b',
              }}>
                <span style={{
                  background: '#1d3461', color: '#93c5fd',
                  fontSize: '11px', fontWeight: '700',
                  padding: '3px 8px', borderRadius: '6px',
                }}>1分取引</span>
                <span style={{ fontSize: '12px', color: '#475569' }}>
                  次の1本で勝敗判定
                </span>
              </div>
              {dur1.length === 0 ? (
                <p style={{ fontSize: '13px', color: '#334155', textAlign: 'center', padding: '16px' }}>
                  データなし（まだ分析中か条件に合う結果がありません）
                </p>
              ) : (
                dur1.map((item) => (
                  <StrategyCard key={item.id} item={item} onClick={() => handleStrategyClick(item)} />
                ))
              )}
            </div>

            {/* 5分取引 section */}
            <div style={{ marginBottom: '24px' }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                marginBottom: '12px', paddingBottom: '8px',
                borderBottom: '1px solid #1e293b',
              }}>
                <span style={{
                  background: '#1d2d46', color: '#7dd3fc',
                  fontSize: '11px', fontWeight: '700',
                  padding: '3px 8px', borderRadius: '6px',
                }}>5分取引</span>
                <span style={{ fontSize: '12px', color: '#475569' }}>
                  5本後で勝敗判定
                </span>
              </div>
              {dur5.length === 0 ? (
                <p style={{ fontSize: '13px', color: '#334155', textAlign: 'center', padding: '16px' }}>
                  データなし（まだ分析中か条件に合う結果がありません）
                </p>
              ) : (
                dur5.map((item) => (
                  <StrategyCard key={item.id} item={item} onClick={() => handleStrategyClick(item)} />
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
