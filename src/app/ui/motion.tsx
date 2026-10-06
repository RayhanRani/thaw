import { CheckCircle2, Info, TriangleAlert } from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'

const join = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ')
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** True once the element has scrolled into view (and immediately when motion is reduced). */
export function useInView<T extends Element>(): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null)
  const [seen, setSeen] = useState(() => reducedMotion() || typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    if (seen || !ref.current) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true)
          io.disconnect()
        }
      },
      { threshold: 0.2 },
    )
    io.observe(ref.current)
    return () => io.disconnect()
  }, [seen])
  return [ref, seen]
}

/** A number that eases to its new value, so a release reads as money visibly coming back. */
export function AnimatedNumber({ value, format, duration = 800, className }: { value: number; format: (v: number) => string; duration?: number; className?: string }) {
  const [shown, setShown] = useState(value)
  const from = useRef(value)
  const raf = useRef(0)
  useEffect(() => {
    if (reducedMotion()) {
      setShown(value)
      from.current = value
      return
    }
    const start = performance.now()
    const a = from.current
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      const v = a + (value - a) * eased
      setShown(v)
      from.current = v
      if (t < 1) raf.current = requestAnimationFrame(step)
    }
    cancelAnimationFrame(raf.current)
    raf.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf.current)
  }, [value, duration])
  return <span className={join('tabular', className)}>{format(shown)}</span>
}

/** One bar split into what Thaw still holds (ice) and what is already back with the merchant (green). */
export function ThawBar({ held, total, height = 10, labels = true, heldLabel = 'Still held', thawedLabel = 'Back in your balance' }: { held: number; total: number; height?: number; labels?: boolean; heldLabel?: string; thawedLabel?: string }) {
  const share = total > 0 ? Math.min(1, held / total) : 0
  return (
    <div>
      <div className="relative flex w-full overflow-hidden rounded-full bg-surface-3" style={{ height }}>
        <div className="fill-thaw relative h-full transition-[width] duration-700 ease-out" style={{ width: `${share * 100}%` }}>
          <div className="frost absolute inset-0" />
          <div className="shimmer absolute inset-0" />
        </div>
        <div className="fill-back h-full flex-1 transition-[width] duration-700 ease-out" style={{ marginLeft: share > 0 && share < 1 ? 2 : 0 }} />
      </div>
      {labels && (
        <div className="mt-2 flex justify-between gap-3 text-xs">
          <span className="inline-flex items-center gap-1.5 text-ink-2">
            <span className="fill-thaw inline-block size-2.5 rounded-sm" />
            {heldLabel}
          </span>
          <span className="inline-flex items-center gap-1.5 text-ink-2">
            <span className="fill-back inline-block size-2.5 rounded-sm" />
            {thawedLabel}
          </span>
        </div>
      )}
    </div>
  )
}

interface ToastItem {
  id: number
  title: string
  body?: string
  tone: 'good' | 'neutral' | 'warn'
}

const ToastContext = createContext<(t: Omit<ToastItem, 'id'>) => void>(() => {})

export function useToast() {
  return useContext(ToastContext)
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const push = useCallback((t: Omit<ToastItem, 'id'>) => {
    const id = Date.now() + Math.random()
    setItems((list) => [...list.slice(-2), { ...t, id }])
    setTimeout(() => setItems((list) => list.filter((x) => x.id !== id)), 5200)
  }, [])
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed right-4 top-20 z-50 flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-2" aria-live="polite">
        {items.map((t) => {
          const Icon = t.tone === 'good' ? CheckCircle2 : t.tone === 'warn' ? TriangleAlert : Info
          return (
            <div key={t.id} className="animate-fade-up rounded-2xl border border-line-2 bg-surface-2/95 p-4 shadow-[var(--shadow-lg)] backdrop-blur">
              <div className="flex items-start gap-3">
                <Icon className={join('mt-0.5 size-5 shrink-0', t.tone === 'good' ? 'text-good-ink' : t.tone === 'warn' ? 'text-critical' : 'text-ink-2')} />
                <div className="min-w-0">
                  <div className="text-[14px] font-semibold text-ink">{t.title}</div>
                  {t.body && <div className="mt-0.5 text-[13px] leading-relaxed text-ink-2">{t.body}</div>}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}
