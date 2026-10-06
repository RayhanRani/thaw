import type { LucideIcon } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { useInView } from './motion'

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

export function Card({ children, className, id }: { children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={cx('card p-6 sm:p-8', className)}>
      {children}
    </section>
  )
}

/** Card heading used on every card: title, one plain sentence, and an optional control on the right. */
export function CardHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h2 className="t-title">{title}</h2>
        {subtitle && <p className="t-small mt-1">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'good' | 'bad' }) {
  return (
    <div className="min-w-0">
      <div className="t-label">{label}</div>
      <div className="tabular mt-2 text-[22px] font-semibold tracking-tight text-ink">{value}</div>
      {sub && <div className={cx('mt-1 text-[13px]', tone === 'good' ? 'text-good-ink' : tone === 'bad' ? 'text-critical' : 'text-muted')}>{sub}</div>}
    </div>
  )
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

export function buttonClass(variant: Variant = 'secondary', size: 'sm' | 'md' = 'md', className?: string) {
  return cx(
    'inline-flex select-none items-center justify-center gap-2 rounded-full font-semibold transition-[background-color,border-color,color,transform] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40',
    size === 'sm' ? 'h-9 px-4 text-[14px]' : 'h-11 px-5 text-[15px]',
    variant === 'primary' && 'bg-gradient-to-r from-sky-300 to-emerald-300 text-slate-950 shadow-lg shadow-sky-500/25 hover:brightness-105',
    variant === 'secondary' && 'border border-white/15 bg-white/5 text-white hover:bg-white/10',
    variant === 'ghost' && 'text-ink-2 hover:bg-white/[0.06] hover:text-ink',
    variant === 'danger' && 'border border-critical/40 bg-critical-soft text-[#f08a8d] hover:bg-critical/15',
    className,
  )
}

export function Button({
  children,
  onClick,
  variant = 'secondary',
  size = 'md',
  disabled,
  type = 'button',
  className,
  title,
}: {
  children: ReactNode
  onClick?: () => void
  variant?: Variant
  size?: 'sm' | 'md'
  disabled?: boolean
  type?: 'button' | 'submit'
  className?: string
  title?: string
}) {
  return (
    <button type={type} title={title} onClick={onClick} disabled={disabled} className={buttonClass(variant, size, className)}>
      {children}
    </button>
  )
}

export function LinkButton({ href, children, variant = 'secondary', size = 'md', className }: { href: string; children: ReactNode; variant?: Variant; size?: 'sm' | 'md'; className?: string }) {
  return (
    <a href={href} className={buttonClass(variant, size, className)}>
      {children}
    </a>
  )
}

/**
 * The one card layout the Merchant and Admin Views use: what you see on the left,
 * what you can do on the right (on a slightly lighter side panel).
 */
export function SplitCard({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx('card grid overflow-hidden lg:grid-cols-[1.35fr_1fr]', className)}>{children}</section>
}

export function Pane({ label, icon: Icon, aside, act, children, className }: { label: string; icon?: LucideIcon; aside?: ReactNode; act?: boolean; children: ReactNode; className?: string }) {
  return (
    <div className={cx('flex min-w-0 flex-col p-6 sm:p-8', act && 'border-t border-sky-300/10 lg:border-l lg:border-t-0', className)}>
      <div className="flex min-h-7 items-center justify-between gap-3">
        <span className="flex items-center gap-2">
          {Icon && <Icon className="size-4 text-sky-300" />}
          <span className="t-label">{label}</span>
        </span>
        {aside}
      </div>
      {children}
    </div>
  )
}

/** "On Thaw" or "Today's reserve": the store's status, the same pill on every page. */
export function StatusPill({ onThaw }: { onThaw: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[13px] font-medium text-ink">
      <span className={cx('relative flex size-2 rounded-full', onThaw ? 'bg-good' : 'bg-critical')}>
        {onThaw && <span className="absolute inset-0 animate-ping rounded-full bg-good opacity-50 motion-reduce:hidden" />}
      </span>
      {onThaw ? 'On Thaw' : 'Today’s reserve'}
    </span>
  )
}

export function Avatar({ initials, size = 44 }: { initials: string; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky-300 to-blue-600 font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.36 }}
      aria-hidden
    >
      {initials}
    </span>
  )
}

export interface CompareRow {
  name: string
  value: number
  text: ReactNode
  /** The Thaw row: shining ice fill and bright text. The other row is today's reserve in slate. */
  thaw?: boolean
}

/**
 * The site's one comparison: today's reserve against Thaw, as two bars on the same scale.
 * Bars grow in when they scroll into view.
 */
export function Compare({ rows, max, className, size = 'md' }: { rows: CompareRow[]; max?: number; className?: string; size?: 'md' | 'lg' }) {
  const [ref, seen] = useInView<HTMLDivElement>()
  const top = Math.max(1e-9, max ?? Math.max(...rows.map((r) => r.value)))
  return (
    <div ref={ref} className={cx(size === 'lg' ? 'space-y-3.5' : 'space-y-3', className)}>
      {rows.map((r) => {
        const share = Math.max(0, Math.min(1, r.value / top))
        return (
          <div key={r.name} className={cx('grid items-center gap-4', size === 'lg' ? 'grid-cols-[64px_1fr_auto] text-[15px]' : 'grid-cols-[52px_1fr_auto] text-[14px]')}>
            <span className={r.thaw ? 'font-medium text-ink' : 'text-ink-2'}>{r.name}</span>
            <span className={cx('relative overflow-hidden rounded-full bg-surface-3', size === 'lg' ? 'h-3' : 'h-2.5')}>
              <span
                className={cx('absolute inset-y-0 left-0 rounded-full transition-[width] duration-[900ms] ease-[cubic-bezier(0.2,0.7,0.2,1)]', r.thaw ? 'fill-thaw' : 'fill-today')}
                style={{ width: `${seen ? (share > 0 ? Math.max(1.5, share * 100) : 0) : 0}%` }}
              >
                {r.thaw && <span className="sheen-bar absolute inset-0 rounded-full" />}
              </span>
            </span>
            <span className={cx('tabular min-w-[56px] text-right', r.thaw ? 'font-semibold text-ink' : 'text-ink-2')}>{r.text}</span>
          </div>
        )
      })}
    </div>
  )
}

/** A labelled on/off row: the switch on the left, the label and a hint beside it. */
export function SwitchRow({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'flex w-full items-center gap-4 rounded-xl px-4 py-3.5 text-left transition-colors',
        disabled ? 'cursor-not-allowed opacity-40' : 'hover:bg-white/[0.04]',
      )}
    >
      <span className={cx('flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors', checked ? 'bg-accent' : 'bg-surface-3 ring-1 ring-inset ring-line-2')}>
        <span className={cx('size-5 rounded-full shadow transition-transform duration-200', checked ? 'translate-x-5 bg-white' : 'bg-slate-400')} />
      </span>
      <span className="min-w-0">
        <span className="block text-[15px] font-medium text-ink">{label}</span>
        {hint && <span className="block text-[13px] text-muted">{hint}</span>}
      </span>
    </button>
  )
}

export type Tone = 'neutral' | 'accent' | 'good' | 'warn' | 'critical'

export function Badge({ children, tone = 'neutral', dot }: { children: ReactNode; tone?: Tone; dot?: boolean }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium',
        tone === 'neutral' && 'bg-surface-3 text-ink-2',
        tone === 'accent' && 'bg-accent-soft text-accent-ink',
        tone === 'good' && 'bg-good-soft text-good-ink',
        tone === 'warn' && 'bg-warn-soft text-warn',
        tone === 'critical' && 'bg-critical-soft text-critical',
      )}
    >
      {dot && (
        <span
          className="size-1.5 rounded-full"
          style={{
            background:
              tone === 'good' ? 'var(--good)' : tone === 'warn' ? 'var(--warn)' : tone === 'critical' ? 'var(--critical)' : tone === 'accent' ? 'var(--accent)' : 'var(--muted)',
          }}
        />
      )}
      {children}
    </span>
  )
}

export function Callout({ children, tone = 'neutral', title }: { children: ReactNode; tone?: 'neutral' | 'accent' | 'warn' | 'good' | 'critical'; title?: ReactNode }) {
  return (
    <div
      className={cx(
        'rounded-xl border px-4 py-3 text-[14px]',
        tone === 'neutral' && 'border-line bg-surface-2 text-ink-2',
        tone === 'accent' && 'border-line-2 bg-accent-soft text-ink',
        tone === 'warn' && 'border-warn/30 bg-warn-soft text-ink',
        tone === 'good' && 'border-good/30 bg-good-soft text-ink',
        tone === 'critical' && 'border-critical/30 bg-critical-soft text-ink',
      )}
    >
      {title && <div className="mb-0.5 font-semibold text-ink">{title}</div>}
      {children}
    </div>
  )
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-full border border-line bg-surface-2 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx('h-8 rounded-full px-3.5 text-[13px] font-medium transition-colors', value === o.value ? 'bg-white text-slate-950' : 'text-ink-2 hover:text-ink')}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
  hint,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  format: (v: number) => string
  hint?: ReactNode
}) {
  const fill = max > min ? ((value - min) / (max - min)) * 100 : 100
  return (
    <label className="block">
      <div className="flex items-baseline justify-between gap-2 text-[14px]">
        <span className="text-ink-2">{label}</span>
        <span className="tabular font-semibold text-ink">{format(value)}</span>
      </div>
      <input
        type="range"
        className="range mt-3"
        style={{ ['--fill' as string]: `${fill}%` }}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </label>
  )
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return <SwitchRow checked={checked} onChange={onChange} label={label} hint={hint} />
}

export function Drawer({ open, onClose, title, children, width = 560 }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; width?: number }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true">
      <button aria-label="Close" className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative flex h-full w-full flex-col border-l border-line bg-surface shadow-2xl" style={{ maxWidth: width }}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div className="min-w-0 text-[15px] font-semibold">{title}</div>
          <button onClick={onClose} className="rounded-md px-2 py-1 text-ink-2 hover:bg-surface-2" aria-label="Close panel">
            ✕
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  )
}

/** Horizontal share bar for breakdowns: a thin track with the value's share filled. */
export function ShareBar({ share, color }: { share: number; color: string }) {
  return (
    <div className="h-1.5 w-full rounded-full bg-surface-3">
      <div className="h-1.5 rounded-full" style={{ width: `${Math.max(0, Math.min(1, share)) * 100}%`, background: color }} />
    </div>
  )
}
