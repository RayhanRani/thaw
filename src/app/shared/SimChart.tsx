import { Pause, Play, RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react'
import { buttonClass } from '../ui'

export interface SimPoint {
  /** Today's reserve. */
  a: number
  /** Thaw. */
  b: number
}

/** Steps an index from start to end on a timer, like a video. */
export function usePlayer(length: number, stepMs: number, start = 0) {
  const [at, setAt] = useState(start)
  const [playing, setPlaying] = useState(false)
  useEffect(() => {
    if (!playing) return
    if (at >= length - 1) {
      setPlaying(false)
      return
    }
    const t = setTimeout(() => setAt(at + 1), stepMs)
    return () => clearTimeout(t)
  }, [playing, at, length, stepMs])
  const toggle = useCallback(() => {
    if (playing) return setPlaying(false)
    if (at >= length - 1) setAt(0)
    setPlaying(true)
  }, [playing, at, length])
  // Any manual move pauses playback.
  const seek = useCallback(
    (i: number) => {
      setPlaying(false)
      setAt(Math.max(0, Math.min(length - 1, i)))
    },
    [length],
  )
  return { at, playing, toggle, seek }
}

export function PlayButton({ playing, atEnd, onClick }: { playing: boolean; atEnd: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={buttonClass('secondary', 'sm', 'h-8 px-3.5 text-[13px]')}>
      {playing ? <Pause className="size-3.5" /> : atEnd ? <RotateCcw className="size-3.5" /> : <Play className="size-3.5" />}
      {playing ? 'Pause' : atEnd ? 'Replay' : 'Play'}
    </button>
  )
}

/**
 * Today's reserve (slate) against Thaw (ice) over time. The gap between them is money back early.
 * Hover or drag across the chart to move the marker.
 */
export function SimChart({ data, at, onSeek, ticks, height = 220 }: { data: SimPoint[]; at: number; onSeek: (i: number) => void; ticks: { i: number; label: string }[]; height?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const n = Math.max(1, data.length - 1)
  const top = Math.max(1e-9, ...data.map((d) => Math.max(d.a, d.b))) * 1.08
  const x = (i: number) => (i / n) * 100
  const y = (v: number) => 100 - (v / top) * 100
  const line = (k: keyof SimPoint) => data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(3)},${y(d[k]).toFixed(3)}`).join(' ')
  const area = (k: keyof SimPoint) => `${line(k)} L100,100 L0,100 Z`
  // The gap between the two lines: money back early.
  const gap = `${line('a')} ${data
    .map((d, i) => [i, d] as const)
    .reverse()
    .map(([i, d]) => `L${x(i).toFixed(3)},${y(d.b).toFixed(3)}`)
    .join(' ')} Z`

  const scrub = (e: PointerEvent<HTMLDivElement>) => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    onSeek(Math.round(((e.clientX - r.left) / r.width) * n))
  }
  const p = data[at]

  return (
    <div>
      <div
        ref={ref}
        className="relative cursor-ew-resize touch-none select-none"
        style={{ height }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          scrub(e)
        }}
        onPointerMove={(e) => {
          if (e.buttons || e.pointerType === 'mouse') scrub(e)
        }}
      >
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
          <defs>
            <linearGradient id="sim-ice" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#38bdf8" stopOpacity="0.3" />
              <stop offset="1" stopColor="#38bdf8" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          {[25, 50, 75].map((g) => (
            <line key={g} x1="0" x2="100" y1={g} y2={g} stroke="rgba(148,163,184,0.08)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          ))}
          <line x1="0" x2="100" y1="100" y2="100" stroke="rgba(148,163,184,0.2)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <path d={gap} fill="rgba(61,165,127,0.16)" />
          <path d={area('b')} fill="url(#sim-ice)" />
          <path d={line('a')} fill="none" stroke="#64748b" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          <path d={line('b')} fill="none" stroke="#38bdf8" strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        </svg>
        <div className="pointer-events-none absolute inset-y-0 w-px bg-white/40" style={{ left: `${x(at)}%` }} />
        <span className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#0b111b] bg-slate-400" style={{ left: `${x(at)}%`, top: `${y(p.a)}%` }} />
        <span
          className="pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#0b111b] bg-sky-400 shadow-[0_0_10px_rgba(56,189,248,0.8)]"
          style={{ left: `${x(at)}%`, top: `${y(p.b)}%` }}
        />
      </div>
      <div className="relative mt-2 h-5 text-[12px] text-muted">
        {ticks.map((t) => (
          <span
            key={t.i}
            className="absolute whitespace-nowrap"
            style={{ left: `${x(t.i)}%`, transform: t.i === 0 ? 'none' : t.i >= n ? 'translateX(-100%)' : 'translateX(-50%)' }}
          >
            {t.label}
          </span>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px] text-ink-2">
        <span className="flex items-center gap-2">
          <span className="h-0.5 w-4 rounded bg-slate-500" /> Today’s reserve
        </span>
        <span className="flex items-center gap-2">
          <span className="h-0.5 w-4 rounded bg-sky-400" /> Thaw
        </span>
        <span className="flex items-center gap-2">
          <span className="size-3 rounded-sm bg-[rgba(61,165,127,0.35)]" /> Back early with Thaw
        </span>
      </div>
    </div>
  )
}

/** Three numbers above a simulation chart: what today's reserve holds, what Thaw holds, and the difference. */
export function SimReadout({ items }: { items: { label: string; value: string; tone?: 'today' | 'thaw' | 'good' }[] }) {
  return (
    <div className="grid grid-cols-3 gap-4">
      {items.map((it) => (
        <div key={it.label} className="min-w-0">
          <div className="truncate text-[13px] text-ink-2">{it.label}</div>
          <div
            className={
              it.tone === 'thaw'
                ? 'tabular text-gradient mt-1 text-[26px] font-semibold tracking-[-0.02em] sm:text-[30px]'
                : it.tone === 'good'
                  ? 'tabular mt-1 text-[26px] font-semibold tracking-[-0.02em] text-good-ink sm:text-[30px]'
                  : 'tabular mt-1 text-[26px] font-semibold tracking-[-0.02em] text-slate-300 sm:text-[30px]'
            }
          >
            {it.value}
          </div>
        </div>
      ))}
    </div>
  )
}
