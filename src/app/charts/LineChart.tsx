import { useState } from 'react'
import { Legend, linear, niceTicks, Tooltip, useWidth } from './core'

export interface LineSeries {
  key: string
  label: string
  color: string
  /** y per x, aligned with `xs`. null = no value. */
  values: (number | null)[]
  /** Wash fill under the line at ~10% opacity. */
  area?: boolean
}

/**
 * Multi-series line chart on one y-axis, with a crosshair that snaps to the nearest x and a
 * tooltip listing every series. Optional vertical marker (e.g. "today") and a shaded band for
 * the projected part of the x range.
 */
export function LineChart({
  xs,
  series,
  xFormat,
  yFormat,
  height = 220,
  marker,
  shadeFrom,
  shadeLabel,
  yMax,
  xTickCount = 6,
  ariaLabel,
  tooltipTitle,
}: {
  xs: number[]
  series: LineSeries[]
  xFormat: (x: number) => string
  yFormat: (y: number) => string
  height?: number
  marker?: { x: number; label: string }
  shadeFrom?: number
  shadeLabel?: string
  yMax?: number
  xTickCount?: number
  ariaLabel: string
  tooltipTitle?: (x: number) => string
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const margin = { top: 12, right: 12, bottom: 26, left: 56 }
  const innerW = Math.max(10, width - margin.left - margin.right)
  const innerH = height - margin.top - margin.bottom
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null))
  const ticks = niceTicks(Math.min(0, ...all), yMax ?? Math.max(1, ...all), 4)
  const y = linear(ticks[0], ticks[ticks.length - 1], innerH, 0)
  const baseline = y(Math.max(0, ticks[0]))
  const x = linear(xs[0], xs[xs.length - 1], 0, innerW)
  const xTicks = niceTicks(xs[0], xs[xs.length - 1], xTickCount).filter((t) => t >= xs[0] && t <= xs[xs.length - 1])

  const path = (vals: (number | null)[]) => {
    let d = ''
    let pen = false
    vals.forEach((v, i) => {
      if (v === null) {
        pen = false
        return
      }
      d += `${pen ? 'L' : 'M'}${x(xs[i]).toFixed(1)},${y(v).toFixed(1)}`
      pen = true
    })
    return d
  }
  const areaPath = (vals: (number | null)[]) => {
    const pts = vals.map((v, i) => (v === null ? null : [x(xs[i]), y(v)] as const)).filter(Boolean) as (readonly [number, number])[]
    if (pts.length < 2) return ''
    return `M${pts[0][0]},${baseline}` + pts.map((p) => `L${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('') + `L${pts[pts.length - 1][0]},${baseline}Z`
  }

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const rect = (e.currentTarget as SVGRectElement).getBoundingClientRect()
    const px = e.clientX - rect.left
    let best = 0
    let bestD = Infinity
    xs.forEach((xv, i) => {
      const dd = Math.abs(x(xv) - px)
      if (dd < bestD) {
        bestD = dd
        best = i
      }
    })
    setHover(best)
  }

  return (
    <div ref={ref} className="relative w-full min-w-0">
      {series.length > 1 && (
        <div className="mb-2">
          <Legend items={series.map((s) => ({ label: s.label, color: s.color, shape: 'line' }))} />
        </div>
      )}
      <svg width={width} height={height} role="img" aria-label={ariaLabel} className="block overflow-visible">
        <g transform={`translate(${margin.left},${margin.top})`}>
          {shadeFrom !== undefined && shadeFrom < xs[xs.length - 1] && (
            <g>
              <rect x={x(Math.max(shadeFrom, xs[0]))} y={0} width={innerW - x(Math.max(shadeFrom, xs[0]))} height={innerH} fill="var(--surface-2)" />
              {shadeLabel && (
                <text x={innerW - 4} y={12} textAnchor="end" fontSize={11} fill="var(--muted)">
                  {shadeLabel}
                </text>
              )}
            </g>
          )}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={0} x2={innerW} y1={y(t)} y2={y(t)} stroke="var(--line)" />
              <text x={-8} y={y(t)} dy="0.32em" textAnchor="end" className="tabular" fontSize={11} fill="var(--muted)">
                {yFormat(t)}
              </text>
            </g>
          ))}
          {xTicks.map((t) => (
            <text key={t} x={x(t)} y={innerH + 17} textAnchor="middle" fontSize={11} fill="var(--muted)">
              {xFormat(t)}
            </text>
          ))}
          <line x1={0} x2={innerW} y1={baseline} y2={baseline} stroke="var(--axis)" />
          {series.map((s) =>
            s.area ? <path key={`${s.key}-a`} d={areaPath(s.values)} fill={s.color} opacity={0.1} /> : null,
          )}
          {series.map((s) => (
            <path key={s.key} d={path(s.values)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {marker && marker.x >= xs[0] && marker.x <= xs[xs.length - 1] && (
            <g>
              <line x1={x(marker.x)} x2={x(marker.x)} y1={0} y2={innerH} stroke="var(--ink-2)" strokeWidth={1} />
              <text x={x(marker.x) + 4} y={10} fontSize={11} fill="var(--ink-2)">
                {marker.label}
              </text>
            </g>
          )}
          {hover !== null && (
            <g>
              <line x1={x(xs[hover])} x2={x(xs[hover])} y1={0} y2={innerH} stroke="var(--axis)" />
              {series.map((s) =>
                s.values[hover] === null ? null : (
                  <circle key={s.key} cx={x(xs[hover])} cy={y(s.values[hover]!)} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
                ),
              )}
            </g>
          )}
          <rect
            x={0}
            y={0}
            width={innerW}
            height={innerH}
            fill="transparent"
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
          />
        </g>
      </svg>
      {hover !== null && (
        <Tooltip
          x={margin.left + x(xs[hover])}
          y={margin.top + 10}
          width={width}
          title={tooltipTitle ? tooltipTitle(xs[hover]) : xFormat(xs[hover])}
          rows={series
            .filter((s) => s.values[hover] !== null)
            .map((s) => ({ label: s.label, value: yFormat(s.values[hover]!), color: s.color }))}
        />
      )}
    </div>
  )
}
