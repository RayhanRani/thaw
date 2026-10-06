import { ArrowRight, Hourglass, MessageSquareWarning, ShieldCheck, Snowflake, Store, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { economics, PRD_ECONOMICS } from '../../engine'
import snapshot from '../data/snapshot.json'
import { compactUsd } from '../lib/format'
import { href } from '../shell/routes'
import { SiteFooter, SiteNav } from '../shell/SiteChrome'
import { Compare, LinkButton } from '../ui'
import { HeroOrder } from './HeroOrder'
import { OrderStepper } from './OrderStepper'

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length

/** The Overview: problem, solution and results, then a way into each view. */
export function Landing() {
  return (
    <div className="site-bg relative min-h-screen overflow-x-clip text-ink">
      <div className="grid-lines pointer-events-none absolute inset-x-0 top-0 h-[800px]" />
      <SiteNav active="landing" />
      <Hero />
      <Problem />
      <Solution />
      <Results />
      <BothSides />
      <SiteFooter />
    </div>
  )
}

function Hero() {
  return (
    <section className="wrap relative grid items-center gap-14 pb-20 pt-16 md:pb-28 md:pt-24 lg:grid-cols-[1.2fr_1fr]">
      <div className="animate-fade-up">
        <h1 className="t-display">
          Reserves that thaw
          <br />
          <span className="text-sheen">as trust is proven.</span>
        </h1>
        <p className="mt-6 max-w-[500px] text-[19px] leading-relaxed text-ink-2">
          Thaw gives merchants their held money back order by order, as soon as there is proof the order is safe, instead of making them wait out a fixed calendar.
        </p>
        <div className="mt-9 flex flex-wrap items-center gap-3">
          <LinkButton href={href('merchant')} variant="primary">
            <Store className="size-4" /> Merchant View
          </LinkButton>
          <LinkButton href={href('admin')}>
            <ShieldCheck className="size-4" /> Admin View
          </LinkButton>
        </div>
      </div>
      <div className="flex justify-center lg:justify-end">
        <HeroOrder />
      </div>
    </section>
  )
}

/** Section header that uses the full width: title on the left, the supporting line on the right. */
function SectionTitle({ eyebrow, title, sub }: { eyebrow: string; title: ReactNode; sub?: ReactNode }) {
  return (
    <div className="grid gap-x-16 gap-y-5 md:grid-cols-2 md:items-end">
      <div>
        <div className="t-eyebrow">{eyebrow}</div>
        <h2 className="t-h1 mt-4">{title}</h2>
      </div>
      {sub && <p className="text-[17px] leading-relaxed text-ink-2 md:pb-1">{sub}</p>}
    </div>
  )
}

function Problem() {
  return (
    <section id="problem" className="section scroll-mt-16 border-t border-line">
      <div className="wrap">
      <SectionTitle
        eyebrow="The problem"
        title="Merchant money is frozen on a calendar."
        sub="Stripe holds back part of a risky merchant’s sales for months, even after orders are paid, delivered and used."
      />
      <div className="mt-12 grid gap-5 md:grid-cols-3">
        <ProblemStat icon={Snowflake} value="Up to 25%" label="of sales held back" />
        <ProblemStat icon={Hourglass} value="90–180" label="days before it comes back" />
        <ProblemStat icon={MessageSquareWarning} value="1.6 / 5" label="Trustpilot rating" />
      </div>
      </div>
    </section>
  )
}

function ProblemStat({ icon: Icon, value, label }: { icon: LucideIcon; value: string; label: string }) {
  return (
    <div className="card p-6 sm:p-8">
      <span className="icon-tile size-10 rounded-xl">
        <Icon className="size-5" />
      </span>
      <div className="t-figure mt-7">{value}</div>
      <div className="t-body mt-2">{label}</div>
    </div>
  )
}

function Solution() {
  return (
    <section id="solution" className="section scroll-mt-16 border-t border-line">
      <div className="wrap">
        <SectionTitle
          eyebrow="The solution"
          title="Release each order the moment it’s proven safe."
          sub="Each piece of proof releases the part of the hold it protects against. Step through one $100 order."
        />
        <div className="mt-12">
          <OrderStepper />
        </div>
        <div className="mt-5 grid gap-5 md:grid-cols-2">
          <Gets icon={Store} who="Merchants get" what="a reason and a return date for every held dollar, and cash today against what’s coming back." />
          <Gets icon={ShieldCheck} who="Stripe keeps" what="a safety minimum on unproven orders, and a switch that puts any store back on today’s reserve." />
        </div>
      </div>
    </section>
  )
}

function Gets({ icon: Icon, who, what }: { icon: LucideIcon; who: string; what: string }) {
  return (
    <div className="card flex items-start gap-4 p-6">
      <span className="icon-tile size-10 shrink-0 rounded-xl">
        <Icon className="size-5" />
      </span>
      <p className="t-body pt-1.5">
        <span className="font-semibold text-ink">{who}</span> {what}
      </p>
    </div>
  )
}

function Results() {
  const cut = mean(snapshot.base.map((r) => r.cut))
  // Stripe-wide: the PRD's middle case, 0.5% of $1.9T held for about 120 days on average.
  const lockedToday = economics(PRD_ECONOMICS).averageBalanceHeld
  const lockedThaw = lockedToday * (1 - cut)
  const day = snapshot.figures.medianDaysThaw
  return (
    <section id="results" className="section scroll-mt-16 border-t border-line">
      <div className="wrap">
      <SectionTitle
        eyebrow="Results"
        title={
          <>
            Less held. Back sooner.
            <br />
            Just as safe.
          </>
        }
        sub="I replayed a year of payments from 300 simulated stores, including ones that fail and ones that cheat, under today’s rules and under Thaw."
      />
      <div className="mt-12 grid gap-5 md:grid-cols-2">
        <Metric
          kind="Cash"
          value={`${Math.round(cut * 100)}% less`}
          label={`merchant money on hold, about ${compactUsd(lockedToday - lockedThaw)} freed across Stripe`}
          rows={[
            { name: 'Today', value: 1, text: '100%' },
            { name: 'Thaw', value: 1 - cut, text: `${Math.round((1 - cut) * 100)}%`, thaw: true },
          ]}
        />
        <Metric
          kind="Speed"
          value={`Day ${day}`}
          label="when half the held money is back"
          rows={[
            { name: 'Today', value: 90, text: 'Day 90' },
            { name: 'Thaw', value: day, text: `Day ${day}`, thaw: true },
          ]}
        />
      </div>
      </div>
    </section>
  )
}

function Metric({ kind, value, label, rows }: { kind: string; value: string; label: string; rows: { name: string; value: number; text: string; thaw?: boolean }[] }) {
  return (
    <div className="card flex flex-col p-6 sm:p-8">
      <div className="t-label">{kind}</div>
      <div className="t-figure text-gradient mt-5">{value}</div>
      <div className="t-body mt-2">{label}</div>
      <Compare className="mt-auto pt-10" size="lg" rows={rows} />
    </div>
  )
}

function BothSides() {
  return (
    <section className="section border-t border-line">
      <div className="wrap">
      <SectionTitle eyebrow="Try it" title="See it from both sides." sub="Two views of the same money. Everything on them is clickable." />
      <div className="mt-12 grid gap-5 md:grid-cols-2">
        <ViewCard
          to={href('merchant')}
          icon={Store}
          title="Merchant View"
          body="What Maya, a new online seller, sees: money on hold, why, and when it comes back."
          tries={['Add tracking', 'Get cash early', 'Jump a week ahead']}
        />
        <ViewCard
          to={href('admin')}
          icon={ShieldCheck}
          title="Admin View"
          body="What Stripe’s risk team controls: the safety switch, and whether Thaw is safe at scale."
          tries={['Flip the safety switch', 'Test it against scammers']}
        />
      </div>
      </div>
    </section>
  )
}

function ViewCard({ to, icon: Icon, title, body, tries }: { to: string; icon: LucideIcon; title: string; body: string; tries: string[] }) {
  return (
    <a href={to} className="card group flex flex-col p-6 transition-colors hover:border-line-2 sm:p-8">
      <div className="flex items-center justify-between">
        <span className="icon-tile size-12 rounded-2xl">
          <Icon className="size-6" />
        </span>
        <span className="flex size-10 items-center justify-center rounded-full border border-line-2 text-ink-2 transition-all group-hover:border-sky-300/50 group-hover:text-sky-300">
          <ArrowRight className="size-5" />
        </span>
      </div>
      <div className="mt-7 text-[24px] font-semibold tracking-[-0.02em] text-ink">{title}</div>
      <p className="t-body mt-2">{body}</p>
      <div className="mt-6 flex flex-wrap gap-2">
        {tries.map((t) => (
          <span key={t} className="rounded-full border border-line-2 bg-surface-2 px-3 py-1 text-[13px] font-medium text-ink-2">
            {t}
          </span>
        ))}
      </div>
    </a>
  )
}
