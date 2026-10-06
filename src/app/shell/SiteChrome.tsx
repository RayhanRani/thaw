import { Logo } from './Logo'
import { href, type Side } from './routes'
import { cx } from '../ui'

const PAGES: { id: Side | 'landing'; label: string }[] = [
  { id: 'landing', label: 'Overview' },
  { id: 'merchant', label: 'Merchant View' },
  { id: 'admin', label: 'Admin View' },
]

/** The one header every page shares: logo on the left, the three pages in the middle, context on the right. */
export function SiteNav({ active }: { active: Side | 'landing' }) {
  return (
    <header className="sticky top-0 z-40 border-b border-white/5 bg-[#070b14]/70 backdrop-blur-xl">
      <div className="wrap grid h-16 grid-cols-[auto_1fr] items-center gap-3 md:grid-cols-[1fr_auto_1fr]">
        <a href={href('landing')} className="flex shrink-0 items-center gap-2.5 justify-self-start" aria-label="Thaw overview">
          <Logo size={28} />
          <span className="hidden text-[18px] font-semibold tracking-tight text-ink sm:inline">Thaw</span>
        </a>
        <nav aria-label="Pages" className="flex min-w-0 items-center gap-0.5 justify-self-end overflow-x-auto rounded-full border border-white/10 bg-white/5 p-1 sm:gap-1 md:justify-self-center">
          {PAGES.map((p) => (
            <a
              key={p.id}
              href={href(p.id)}
              aria-current={active === p.id ? 'page' : undefined}
              className={cx(
                'whitespace-nowrap rounded-full px-2.5 py-1.5 text-[13px] font-medium transition-colors sm:px-4 sm:text-[14px]',
                active === p.id ? 'glow-ice bg-white text-slate-950' : 'text-slate-300 hover:text-white',
              )}
            >
              {p.label}
            </a>
          ))}
        </nav>
        <span className="hidden items-center gap-2 justify-self-end rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[13px] font-medium text-slate-300 md:inline-flex">
          <span className="size-1.5 rounded-full bg-sky-300 shadow-[0_0_8px_rgba(56,189,248,0.8)]" />A product concept for Stripe
        </span>
      </div>
    </header>
  )
}

/** The one footer every page shares. */
export function SiteFooter({ className }: { className?: string }) {
  return (
    <footer className={cx('border-t border-line', className)}>
      <div className="wrap flex flex-wrap items-center justify-between gap-4 py-8 text-[13px] text-muted">
        <span className="flex items-center gap-2">
          <Logo size={22} />
          <span className="font-semibold text-ink-2">Thaw</span>
        </span>
        <span>An independent concept by Rayhan Rani. Not affiliated with Stripe.</span>
      </div>
    </footer>
  )
}
