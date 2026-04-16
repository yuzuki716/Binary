import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../store/useStore'
import { fetchChart } from '../api'
import type { ChartResponse, TradeRecord } from '../types'
import WinRateBadge from '../components/common/WinRateBadge'

export default function ChartPage() {
  const { simId, strategyId } = useParams<{ simId: string; strategyId: string }>()
  const navigate = useNavigate()
  const { selectedStrategy } = useStore()
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const indicatorContainerRef = useRef<HTMLDivElement>(null)
  const [chartData, setChartData] = useState<ChartResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!simId || !strategyId) return
    setLoading(true)
    fetchChart(simId, Number(strategyId))
      .then((data) => {
        setChartData(data)
        setLoading(false)
      })
      .catch((e) => {
        setError(e.message)
        setLoading(false)
      })
  }, [simId, strategyId])

  useEffect(() => {
    if (!chartData || !chartContainerRef.current) return

    let chart: any = null
    let indicatorChart: any = null

    const initChart = async () => {
      const lwc = await import('lightweight-charts')

      const baseChartOptions = {
        layout: {
          background: { color: '#0a0f1e' },
          textColor: '#64748b',
        },
        grid: {
          vertLines: { color: '#1e293b' },
          horzLines: { color: '#1e293b' },
        },
        crosshair: { mode: lwc.CrosshairMode.Normal },
        rightPriceScale: { borderColor: '#334155' },
        timeScale: {
          borderColor: '#334155',
          timeVisible: true,
          secondsVisible: false,
        },
        handleScroll: true,
        handleScale: true,
      }

      // Main chart
      chart = lwc.createChart(chartContainerRef.current!, {
        ...baseChartOptions,
        width: chartContainerRef.current!.clientWidth,
        height: 280,
      })

      const candleSeries = chart.addSeries(lwc.CandlestickSeries, {
        upColor: '#22c55e',
        downColor: '#ef4444',
        borderVisible: false,
        wickUpColor: '#22c55e',
        wickDownColor: '#ef4444',
      })
      candleSeries.setData(chartData.ohlcv)

      // Add indicator overlays on main chart (pane 0)
      const mainIndicators = chartData.indicators.filter((i) => i.pane === 0)
      for (const ind of mainIndicators) {
        const lineSeries = chart.addSeries(lwc.LineSeries, {
          color: ind.color,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
        })
        lineSeries.setData(ind.data)
      }

      // Trade markers
      const markers = chartData.trades.map((t: TradeRecord) => ({
        time: t.entry_time,
        position: t.direction === 'CALL' ? 'belowBar' as const : 'aboveBar' as const,
        color: t.outcome === 'WIN' ? '#22c55e' : '#ef4444',
        shape: t.direction === 'CALL' ? 'arrowUp' as const : 'arrowDown' as const,
        size: 1,
        text: t.outcome === 'WIN' ? '✓' : '✗',
      }))
      candleSeries.setMarkers(markers)

      // Oscillator chart (pane 1+)
      const oscIndicators = chartData.indicators.filter((i) => i.pane > 0)
      if (oscIndicators.length > 0 && indicatorContainerRef.current) {
        indicatorChart = lwc.createChart(indicatorContainerRef.current!, {
          ...baseChartOptions,
          width: indicatorContainerRef.current!.clientWidth,
          height: 130,
          timeScale: {
            ...baseChartOptions.timeScale,
            visible: false,
          },
        })

        for (const ind of oscIndicators) {
          if (ind.series_type === 'histogram') {
            const histSeries = indicatorChart.addSeries(lwc.HistogramSeries, {
              priceLineVisible: false,
              lastValueVisible: false,
            })
            histSeries.setData(ind.data)
          } else {
            const lineSeries = indicatorChart.addSeries(lwc.LineSeries, {
              color: ind.color,
              lineWidth: 1,
              priceLineVisible: false,
              lastValueVisible: false,
            })
            lineSeries.setData(ind.data.map((d: any) => ({ time: d.time, value: d.value })))
          }
        }

        // RSI reference lines
        const rsiNames = oscIndicators.map((i) => i.name)
        if (rsiNames.includes('rsi')) {
          for (const level of [70, 50, 30]) {
            const refLine = indicatorChart.addSeries(lwc.LineSeries, {
              color: '#334155',
              lineWidth: 1,
              lineStyle: 2, // dashed
              priceLineVisible: false,
              lastValueVisible: false,
            })
            const refData = chartData.ohlcv.slice(0, 2).map((o: any) => ({ time: o.time, value: level }))
            if (refData.length >= 2) {
              refLine.setData([
                { time: chartData.ohlcv[0].time, value: level },
                { time: chartData.ohlcv[chartData.ohlcv.length - 1].time, value: level },
              ])
            }
          }
        }

        // Sync time scales
        chart.timeScale().subscribeVisibleLogicalRangeChange((range: any) => {
          if (range) indicatorChart.timeScale().setVisibleLogicalRange(range)
        })
      }

      // Fit content
      chart.timeScale().fitContent()

      // Resize observer
      const ro = new ResizeObserver(() => {
        if (chartContainerRef.current) {
          chart?.applyOptions({ width: chartContainerRef.current.clientWidth })
        }
        if (indicatorContainerRef.current) {
          indicatorChart?.applyOptions({ width: indicatorContainerRef.current.clientWidth })
        }
      })
      if (chartContainerRef.current) ro.observe(chartContainerRef.current)
      if (indicatorContainerRef.current) ro.observe(indicatorContainerRef.current)

      return () => {
        ro.disconnect()
        chart?.remove()
        indicatorChart?.remove()
      }
    }

    let cleanup: (() => void) | undefined
    initChart().then((fn) => { cleanup = fn })
    return () => { cleanup?.() }
  }, [chartData])

  const data = chartData || (selectedStrategy ? {
    strategy_name: selectedStrategy.strategy_name,
    win_rate: selectedStrategy.win_rate,
    total_trades: selectedStrategy.total_trades,
    wins: selectedStrategy.wins,
    losses: selectedStrategy.losses,
    ohlcv: [],
    indicators: [],
    trades: [],
  } : null)

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', paddingBottom: '80px' }}>
      {/* Header */}
      <div style={{ padding: '14px 16px', background: '#1e293b', borderBottom: '1px solid #334155' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            onClick={() => navigate(-1)}
            style={{ background: 'none', border: 'none', color: '#3b82f6', fontSize: '20px', cursor: 'pointer', padding: 0, lineHeight: 1 }}
          >
            ←
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '13px', fontWeight: '700', color: '#f1f5f9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {data?.strategy_name || '...'}
            </div>
          </div>
        </div>
      </div>

      {loading && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '200px', color: '#64748b' }}>
          チャートを読み込み中...
        </div>
      )}

      {error && (
        <div style={{ margin: '16px', padding: '12px', borderRadius: '8px', background: '#1e0a0a', border: '1px solid #ef4444', color: '#fca5a5', fontSize: '13px' }}>
          {error}
        </div>
      )}

      {data && !loading && (
        <>
          {/* Stats card */}
          <div style={{
            margin: '12px',
            padding: '14px',
            background: '#1e293b',
            borderRadius: '12px',
            border: '1px solid #334155',
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: '8px',
            textAlign: 'center',
          }}>
            <StatItem label="勝率" value={<WinRateBadge winRate={data.win_rate} size="lg" />} />
            <StatItem label="取引数" value={data.total_trades.toString()} />
            <StatItem label="勝ち" value={data.wins.toString()} color="#22c55e" />
            <StatItem label="負け" value={data.losses.toString()} color="#ef4444" />
          </div>

          {/* Main chart */}
          <div ref={chartContainerRef} style={{ width: '100%', height: '280px', margin: '0' }} />

          {/* Oscillator panel */}
          {chartData && chartData.indicators.some((i) => i.pane > 0) && (
            <div ref={indicatorContainerRef} style={{ width: '100%', height: '130px', borderTop: '1px solid #1e293b' }} />
          )}

          {/* Trade stats */}
          <div style={{ padding: '12px 12px 0' }}>
            <h3 style={{ margin: '0 0 10px', fontSize: '12px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              トレード一覧
            </h3>
            <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
              {data.trades.length > 0 ? (
                data.trades.map((t, i) => (
                  <div key={i} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '8px 0', borderBottom: '1px solid #1e293b', fontSize: '12px',
                  }}>
                    <span style={{ color: t.direction === 'CALL' ? '#22c55e' : '#ef4444', fontWeight: '600', minWidth: '40px' }}>
                      {t.direction}
                    </span>
                    <span style={{ color: '#64748b' }}>
                      {new Date(t.entry_time * 1000).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span style={{ color: '#94a3b8' }}>
                      {t.entry_price.toFixed(5)}
                    </span>
                    <span style={{
                      color: t.outcome === 'WIN' ? '#22c55e' : '#ef4444',
                      fontWeight: '700',
                    }}>
                      {t.outcome === 'WIN' ? '✓ WIN' : '✗ LOSS'}
                    </span>
                  </div>
                ))
              ) : (
                <p style={{ color: '#475569', fontSize: '13px' }}>トレードデータなし</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function StatItem({ label, value, color }: { label: string; value: string | React.ReactNode; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: '10px', color: '#64748b', marginBottom: '4px' }}>{label}</div>
      <div style={{ fontSize: '16px', fontWeight: '700', color: color || '#f1f5f9' }}>
        {value}
      </div>
    </div>
  )
}
