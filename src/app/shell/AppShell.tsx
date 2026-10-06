import type { ReactNode } from 'react'
import { DemoDock } from './DemoDock'
import type { Side } from './routes'
import { SiteFooter, SiteNav } from './SiteChrome'

/** Merchant and admin pages: same header, background and footer as the Overview, plus the demo bar. */
export function AppShell({ side, children }: { side: Side; children: ReactNode }) {
  return (
    <div className="site-bg relative min-h-screen overflow-x-clip text-ink">
      <div className="grid-lines pointer-events-none absolute inset-x-0 top-0 h-[800px]" />
      <SiteNav active={side} />
      <main className="wrap relative pb-28 pt-14 md:pt-20">
        <div key={side} className="animate-fade-up">
          {children}
        </div>
      </main>
      {/* Extra room so the footer clears the floating demo bar. */}
      <SiteFooter className="pb-24" />
      <DemoDock />
    </div>
  )
}

/** Page title block shared by the Merchant and Admin Views (same layout as the Overview's section titles). */
export function PageHeader({ title, subtitle, eyebrow, action }: { title: string; subtitle?: ReactNode; eyebrow?: string; action?: ReactNode }) {
  return (
    <div className="mb-10 grid gap-x-16 gap-y-5 md:mb-12 md:grid-cols-[1fr_1fr] md:items-end">
      <div className="min-w-0">
        {eyebrow && <div className="t-eyebrow">{eyebrow}</div>}
        <h1 className="t-h1 mt-4">{title}</h1>
      </div>
      {(subtitle || action) && (
        <div className="md:pb-1">
          {subtitle && <p className="text-[17px] leading-relaxed text-ink-2">{subtitle}</p>}
          {action && <div className="mt-4">{action}</div>}
        </div>
      )}
    </div>
  )
}

/** A numbered question that introduces each card on the Merchant and Admin Views. */
export function SectionHead({ n, title, sub }: { n: string; title: string; sub?: ReactNode }) {
  return (
    <div className="mb-5 mt-16 grid gap-x-16 gap-y-2 first:mt-0 md:grid-cols-[1fr_1fr] md:items-end">
      <div className="flex items-baseline gap-3">
        <span className="tabular text-[14px] font-semibold text-sky-300">{n}</span>
        <h2 className="text-[24px] font-semibold tracking-[-0.02em] text-ink">{title}</h2>
      </div>
      {sub && <p className="t-small md:pb-1">{sub}</p>}
    </div>
  )
}
