interface Props {
  winRate: number
  size?: 'sm' | 'md' | 'lg'
}

export default function WinRateBadge({ winRate, size = 'md' }: Props) {
  const pct = Math.round(winRate * 100)

  const bg =
    pct >= 65 ? '#14532d' :
    pct >= 55 ? '#451a03' :
    '#1e1b4b'

  const color =
    pct >= 65 ? '#4ade80' :
    pct >= 55 ? '#fcd34d' :
    '#a5b4fc'

  const fontSize = size === 'lg' ? '20px' : size === 'sm' ? '11px' : '13px'
  const padding = size === 'lg' ? '6px 14px' : size === 'sm' ? '2px 6px' : '3px 8px'

  return (
    <span
      style={{
        background: bg,
        color,
        fontSize,
        fontWeight: '700',
        padding,
        borderRadius: '6px',
        display: 'inline-block',
        minWidth: size === 'lg' ? '80px' : '56px',
        textAlign: 'center',
      }}
    >
      {pct}%
    </span>
  )
}
