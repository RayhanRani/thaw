import { useState } from 'react'
import { Legend, linear, niceTicks, Tooltip, useWidth } from './core'

export interface XYPoint {
  x: number
  y: number
  label: string
}

export interface XYSeries {
  key: string
  label: string
  color: string
  points: XYPoint[]
}

/**
 * Connected scatter for trade-off frontiers. Every point has a nearest-point hit layer, so the
 * pointer only has to be closest, not dead-center. Highlighted points get a direct label.
 */
export function XYChart({
  series,
  highlights = [],
  xFormat,
  yFormat,
  xLabel,
  yLabel,
  height = 280,
  ariaLabel,
}: {
  series: XYSeries[]
  highlights?: { x: number; y: number; label: string }[]
  xFormat: (v: number) => string
  yFormat: (v: number) => string
  xLabel: string
  yLabel: string
  height?: number
  ariaLabel: string
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<{ s: number; p: number } | null>(null)
  const margin = { top: 16, right: 16, bottom: 40, left: 56 }
  const innerW = Math.max(10, width - margin.left - margin.right)
  const innerH = height - margin.top - margin.bottom
  const pts = series.flatMap((s) => s.points)
  const xt = niceTicks(0, Math.max(...pts.map((p) => p.x)), 5)
  const yt = niceTicks(0, Math.max(0.1, ...pts.map((p) => p.y)), 4)
  const x = linear(0, xt[xt.length - 1], 0, innerW)
  const y = linear(0, yt[yt.length - 1], innerH, 0)

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const rect = (e.currentTarget as SVGRectElement).getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    let best: { s: number; p: number } | null = null
    let bestD = 40 * 40
    series.forEach((s, si) =>
      s.points.forEach((p, pi) => {
        const d = (x(p.x) - px) ** 2 + (y(p.y) - py) ** 2
        if (d < bestD) {
          bestD = d
          best = { s: si, p: pi }
        }
      }),
    )
    setHover(best)
  }

  const hp = hover ? series[hover.s].points[hover.p] : null

  return (
    <div ref={ref} className="relative w-full min-w-0">
      <div className="mb-2">
        <Legend items={series.map((s) => ({ label: s.label, color: s.color, shape: 'line' }))} />
      </div>
      <svg width={width} height={height} role="img" aria-label={ariaLabel} className="block overflow-visible">
        <g transform={`translate(${margin.left},${margin.top})`}>
          {yt.map((t) => (
            <g key={`y${t}`}>
              <line x1={0} x2={innerW} y1={y(t)} y2={y(t)} stroke="var(--line)" />
              <text x={-8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} className="tabular" fill="var(--muted)">
                {yFormat(t)}
              </text>
            </g>
          ))}
          {xt.map((t) => (
            <text key={`x${t}`} x={x(t)} y={innerH + 17} textAnchor="middle" fontSize={11} className="tabular" fill="var(--muted)">
              {xFormat(t)}
            </text>
          ))}
          <line x1={0} x2={innerW} y1={innerH} y2={innerH} stroke="var(--axis)" />
          <text x={innerW / 2} y={innerH + 34} textAnchor="middle" fontSize={11} fill="var(--ink-2)">
            {xLabel}
          </text>
          <text transform={`translate(${-44},${innerH / 2}) rotate(-90)`} textAnchor="middle" fontSize={11} fill="var(--ink-2)">
            {yLabel}
          </text>
          {series.map((s) => (
            <g key={s.key}>
              <path
                d={s.points.map((p, i) => `${i ? 'L' : 'M'}${x(p.x).toFixed(1)},${y(p.y).toFixed(1)}`).join('')}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeLinejoin="round"
              />
              {s.points.map((p, i) => (
                <circle key={i} cx={x(p.x)} cy={y(p.y)} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
              ))}
            </g>
          ))}
          {highlights.map((h) => (
            <g key={h.label}>
              <circle cx={x(h.x)} cy={y(h.y)} r={7} fill="none" stroke="var(--ink)" strokeWidth={1.5} />
              <text x={x(h.x) + 10} y={y(h.y) - 10} fontSize={11} fontWeight={600} fill="var(--ink)">
                {h.label}
              </text>
            </g>
          ))}
          {hp && <circle cx={x(hp.x)} cy={y(hp.y)} r={6} fill={series[hover!.s].color} stroke="var(--surface)" strokeWidth={2} />}
          <rect x={0} y={0} width={innerW} height={innerH} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
        </g>
      </svg>
      {hp && (
        <Tooltip
          x={margin.left + x(hp.x)}
          y={margin.top + y(hp.y)}
          width={width}
          title={hp.label}
          rows={[
            { label: xLabel, value: xFormat(hp.x), color: series[hover!.s].color },
            { label: yLabel, value: yFormat(hp.y) },
          ]}
        />
      )}
    </div>
  )
}
