import { useState } from 'react'
import { Legend, linear, niceTicks, roundedTopRect, Tooltip, useWidth, type TooltipRow } from './core'

export interface ColumnSeries {
  key: string
  label: string
  color: string
}

export interface ColumnDatum {
  key: string
  label: string
  /** Value per series key. */
  values: Record<string, number>
  /** Optional reference value drawn as a tick on the column (e.g. what the flat reserve releases). */
  reference?: number
}

/** Stacked columns with a 2px surface gap between segments and the column as the hover target. */
export function ColumnChart({
  data,
  series,
  height = 220,
  yFormat,
  referenceLabel,
  selectedKey,
  onSelect,
  tooltipFooter,
  ariaLabel,
}: {
  data: ColumnDatum[]
  series: ColumnSeries[]
  height?: number
  yFormat: (v: number) => string
  referenceLabel?: string
  selectedKey?: string | null
  onSelect?: (key: string | null) => void
  tooltipFooter?: (d: ColumnDatum) => React.ReactNode
  ariaLabel: string
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const margin = { top: 10, right: 8, bottom: 26, left: 52 }
  const innerW = Math.max(10, width - margin.left - margin.right)
  const innerH = height - margin.top - margin.bottom
  const totals = data.map((d) => series.reduce((s, sr) => s + (d.values[sr.key] ?? 0), 0))
  const maxV = Math.max(1, ...totals, ...data.map((d) => d.reference ?? 0))
  const ticks = niceTicks(0, maxV, 4)
  const y = linear(0, ticks[ticks.length - 1], innerH, 0)
  const band = innerW / Math.max(1, data.length)
  const barW = Math.min(24, band * 0.62)
  const labelEvery = Math.ceil(data.length / Math.max(1, Math.floor(innerW / 54)))
  const GAP = 2

  const legend = [
    ...series.map((s) => ({ label: s.label, color: s.color })),
    ...(referenceLabel ? [{ label: referenceLabel, color: 'var(--ink-2)', shape: 'line' as const }] : []),
  ]

  return (
    <div ref={ref} className="relative w-full min-w-0">
      <div className="mb-2">
        <Legend items={legend} />
      </div>
      <svg width={width} height={height} role="img" aria-label={ariaLabel} className="block overflow-visible">
        <g transform={`translate(${margin.left},${margin.top})`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={0} x2={innerW} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} />
              <text x={-8} y={y(t)} dy="0.32em" textAnchor="end" className="tabular" fontSize={11} fill="var(--muted)">
                {yFormat(t)}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const cx = i * band + band / 2
            const x0 = cx - barW / 2
            let acc = 0
            const segs = series
              .map((s) => ({ s, v: d.values[s.key] ?? 0 }))
              .filter((seg) => seg.v > 0)
            const dim = selectedKey != null && selectedKey !== d.key
            return (
              <g
                key={d.key}
                opacity={dim ? 0.35 : 1}
                tabIndex={0}
                role="button"
                aria-label={`${d.label}: ${yFormat(totals[i])}`}
                onPointerEnter={() => setHover(i)}
                onPointerLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                onClick={() => onSelect?.(selectedKey === d.key ? null : d.key)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') onSelect?.(selectedKey === d.key ? null : d.key)
                }}
                style={{ cursor: onSelect ? 'pointer' : 'default', outline: 'none' }}
              >
                <rect x={i * band} y={0} width={band} height={innerH} fill={hover === i ? 'var(--surface-2)' : 'transparent'} />
                {segs.map((seg, j) => {
                  const top = y(acc + seg.v)
                  const bottom = y(acc)
                  acc += seg.v
                  const isTop = j === segs.length - 1
                  const h = Math.max(0, bottom - top - (j > 0 ? GAP : 0))
                  if (h <= 0) return null
                  return isTop ? (
                    <path key={seg.s.key} d={roundedTopRect(x0, top, barW, h)} fill={seg.s.color} />
                  ) : (
                    <rect key={seg.s.key} x={x0} y={top} width={barW} height={h} fill={seg.s.color} />
                  )
                })}
                {d.reference !== undefined && d.reference > 0 && (
                  <line x1={x0 - 3} x2={x0 + barW + 3} y1={y(d.reference)} y2={y(d.reference)} stroke="var(--ink-2)" strokeWidth={2} strokeLinecap="round" />
                )}
                {i % labelEvery === 0 && (
                  <text x={cx} y={innerH + 17} textAnchor="middle" fontSize={11} fill="var(--muted)">
                    {d.label}
                  </text>
                )}
              </g>
            )
          })}
          <line x1={0} x2={innerW} y1={innerH} y2={innerH} stroke="var(--axis)" strokeWidth={1} />
        </g>
      </svg>
      {hover !== null && data[hover] && (
        <Tooltip
          x={margin.left + hover * band + band / 2}
          y={margin.top + y(Math.max(totals[hover], data[hover].reference ?? 0)) + 20}
          width={width}
          title={data[hover].label}
          rows={[
            { label: 'total', value: yFormat(totals[hover]) },
            ...series
              .filter((s) => (data[hover].values[s.key] ?? 0) > 0)
              .map<TooltipRow>((s) => ({ label: s.label, value: yFormat(data[hover].values[s.key]), color: s.color })),
            ...(data[hover].reference !== undefined && referenceLabel
              ? [{ label: referenceLabel, value: yFormat(data[hover].reference!), color: 'var(--ink-2)' }]
              : []),
          ]}
          footer={tooltipFooter?.(data[hover])}
        />
      )}
    </div>
  )
}
