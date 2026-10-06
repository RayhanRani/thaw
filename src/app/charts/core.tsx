/**
 * Small, dependency-free SVG chart kit. Follows the dataviz method: thin marks, 4px rounded
 * data-ends, 2px surface gaps, hairline solid grid, a hover layer on every chart, and text
 * in ink tokens rather than series colors.
 */

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

export function useWidth<T extends HTMLElement>(fallback = 320): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(fallback)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.getBoundingClientRect().width)
    const ro = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width]
}

/** Round tick values covering [min, max]. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (max === min) max = min + 1
  const span = max - min
  const step0 = span / Math.max(1, count)
  const mag = Math.pow(10, Math.floor(Math.log10(step0)))
  const err = step0 / mag
  const step = (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * mag
  const start = Math.floor(min / step) * step
  const end = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let v = start; v <= end + step / 2; v += step) ticks.push(Math.round(v / step) * step)
  return ticks
}

export function linear(d0: number, d1: number, r0: number, r1: number) {
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0)
  return (v: number) => r0 + (v - d0) * k
}

export interface LegendItem {
  label: string
  color: string
  shape?: 'rect' | 'line'
}

export function Legend({ items }: { items: LegendItem[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-2">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5">
          {it.shape === 'line' ? (
            <span className="inline-block h-0.5 w-3.5 rounded-full" style={{ background: it.color }} />
          ) : (
            <span className="inline-block size-2.5 rounded-[3px]" style={{ background: it.color }} />
          )}
          {it.label}
        </span>
      ))}
    </div>
  )
}

export interface TooltipRow {
  label: string
  value: string
  color?: string
}

/** Values lead, labels follow; series keyed with a short line in the series color. */
export function Tooltip({ x, y, width, title, rows, footer }: { x: number; y: number; width: number; title: string; rows: TooltipRow[]; footer?: ReactNode }) {
  const w = 220
  const left = Math.min(Math.max(8, x + 14), Math.max(8, width - w - 8))
  return (
    <div
      role="status"
      className="pointer-events-none absolute z-10 rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg"
      style={{ left, top: Math.max(0, y - 8), width: w }}
    >
      <div className="mb-1 font-medium text-ink-2">{title}</div>
      <div className="space-y-0.5">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-2">
            {r.color && <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: r.color }} />}
            <span className="tabular font-semibold text-ink">{r.value}</span>
            <span className="truncate text-ink-2">{r.label}</span>
          </div>
        ))}
      </div>
      {footer && <div className="mt-1.5 border-t border-line pt-1.5 text-muted">{footer}</div>}
    </div>
  )
}

/** Column with a 4px rounded data-end and a square base. */
export function roundedTopRect(x: number, y: number, w: number, h: number, r = 4): string {
  if (h <= 0) return ''
  const rr = Math.min(r, w / 2, h)
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`
}
