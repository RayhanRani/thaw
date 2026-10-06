import { Banknote, CalendarClock, CheckCircle2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { DEFAULT_ADVANCE_TERMS } from '../../engine'
import { dayLabel, money } from '../lib/format'
import { PageHeader, SectionHead } from '../shell/AppShell'
import { useDemo } from '../state/demo'
import { Button, cx, Pane, SplitCard } from '../ui'
import { AnimatedNumber, useToast } from '../ui/motion'
import { BalanceHero } from './BalanceHero'
import { SaleSimulation } from './SaleSimulation'

/** The merchant view, as three questions Maya would ask. The last one is answered by the research simulation. */
export function MerchantHome() {
  return (
    <>
      <PageHeader eyebrow="Merchant View" title="Clayhouse Studio" subtitle="What Maya, a new online seller, sees: how much is on hold, why, and when it comes back." />
      <div>
        <SectionHead n="01" title="How much is held, and why?" sub="Every dollar has a reason. Proof, like a tracking number, releases it sooner." />
        <BalanceHero />
        <SectionHead n="02" title="When do I get it?" sub="Her schedule for the next 8 weeks, and cash today if she needs it." />
        <SplitCard>
          <ComingBack />
          <Advance />
        </SplitCard>
        <SectionHead n="03" title="Simulation: what happens to one sale?" sub="From my simulation of 300 stores: the money held from a $1,000 sale, day by day, under today’s reserve and under Thaw." />
        <SaleSimulation />
      </div>
    </>
  )
}

/** When the money comes back, week by week. Hover a week to read it. */
function ComingBack() {
  const { releases, today } = useDemo()
  const weeks = useMemo(() => {
    const out: { label: string; short: string; amount: number }[] = []
    for (let w = 0; w < 8; w++) {
      const from = today + 1 + w * 7
      const amount = releases.filter((r) => r.day >= from && r.day < from + 7).reduce((s, r) => s + r.total, 0)
      out.push({ label: w === 0 ? 'this week' : `the week of ${dayLabel(from)}`, short: w === 0 ? 'Now' : dayLabel(from), amount })
    }
    return out
  }, [releases, today])
  const [active, setActive] = useState(0)
  const max = Math.max(1, ...weeks.map((w) => w.amount))
  const shown = weeks[active]

  return (
    <Pane label="Next 8 weeks" icon={CalendarClock}>
      <div className="t-figure mt-5 !text-good-ink">
        +<AnimatedNumber value={shown.amount} format={(v) => money(v)} duration={400} />
      </div>
      <div className="mt-3 text-[16px] font-medium text-ink-2">back with you {shown.label}</div>
      <div className="mt-auto pt-8">
        <div className="grid h-40 grid-cols-8 items-end gap-2" onMouseLeave={() => setActive(0)}>
          {weeks.map((w, i) => (
            <button
              key={w.label}
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              aria-label={`${w.label}: ${money(w.amount)}`}
              className="group flex h-full flex-col justify-end rounded-md"
            >
              <span
                className={cx('block w-full rounded-md transition-all duration-500', i === active ? 'bg-[var(--released)]' : 'bg-white/10 group-hover:bg-white/20')}
                style={{ height: `${Math.max(3, (w.amount / max) * 100)}%` }}
              />
            </button>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-8 gap-2">
          {weeks.map((w, i) => (
            <span key={w.label} className={cx('truncate text-center text-[11px] sm:text-[12px]', i === active ? 'font-medium text-ink' : 'text-muted')}>
              {w.short}
            </span>
          ))}
        </div>
      </div>
    </Pane>
  )
}

/** Thaw Advance: pick an amount, see the one fixed fee, confirm. */
function Advance() {
  const { advanceQuote, advance, advanceRepaid, acceptAdvance } = useDemo()
  const toast = useToast()
  const max = useMemo(() => advanceQuote('max'), [advanceQuote])
  const [picked, setPicked] = useState<number | null>(null)
  const amount = Math.min(picked ?? max.maxAdvance, max.maxAdvance)
  const q = useMemo(() => advanceQuote(amount), [advanceQuote, amount])
  const [confirming, setConfirming] = useState(false)
  const min = DEFAULT_ADVANCE_TERMS.minAdvance
  const fill = max.maxAdvance > min ? ((amount - min) / (max.maxAdvance - min)) * 100 : 100

  if (advance) {
    return (
      <Pane label="Your advance" icon={Banknote} act>
        <div className="t-figure mt-5">{money(advance.amount)}</div>
        <div className="mt-3 text-[16px] font-medium text-ink-2">received, fee {money(advance.fee, { cents: true })}</div>
        <div className="mt-auto pt-8">
          <div className="h-2.5 overflow-hidden rounded-full bg-white/[0.06]">
            <div className="fill-back h-full rounded-full transition-[width] duration-700" style={{ width: `${(advanceRepaid / advance.total) * 100}%` }} />
          </div>
          <div className="mt-3 flex justify-between gap-3 text-[14px]">
            <span className="text-ink-2">
              Repaid <span className="font-semibold text-good-ink">{money(advanceRepaid)}</span> of {money(advance.total)}
            </span>
            <span className="text-muted">{advanceRepaid >= advance.total ? 'Paid off' : 'Repays itself'}</span>
          </div>
        </div>
      </Pane>
    )
  }

  return (
    <Pane label="Need it sooner?" icon={Banknote} act>
      {!max.eligible ? (
        <p className="t-body mt-5">{max.ineligibleReason}</p>
      ) : (
        <>
          <div className="t-figure mt-5">
            <AnimatedNumber value={amount} format={(v) => money(v)} duration={250} />
          </div>
          <div className="mt-3 text-[16px] font-medium text-ink-2">today, repaid from the money coming back</div>
          <input
            type="range"
            aria-label="Advance amount"
            className="range mt-8"
            style={{ ['--fill' as string]: `${fill}%` }}
            min={min}
            max={max.maxAdvance}
            step={10_00}
            value={amount}
            onChange={(e) => {
              setPicked(Number(e.target.value))
              setConfirming(false)
            }}
          />
          <div className="mt-4 flex justify-between gap-3 text-[14px] text-ink-2">
            <span>
              Fixed fee <span className="tabular font-semibold text-ink">{money(q.fee, { cents: true })}</span>
            </span>
            <span>
              Paid back by <span className="font-semibold text-ink">{q.expectedPaidOffDay ? dayLabel(q.expectedPaidOffDay) : 'day 60'}</span>
            </span>
          </div>
          <div className="mt-auto pt-8">
            {!confirming ? (
              <Button variant="primary" className="w-full" onClick={() => setConfirming(true)}>
                Get {money(q.amount)} now
              </Button>
            ) : (
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <Button
                  variant="primary"
                  onClick={() => {
                    acceptAdvance(q.amount)
                    toast({ title: `${money(q.amount)} is on its way`, body: `Repaid from the money coming off hold. Fee ${money(q.fee, { cents: true })}.`, tone: 'good' })
                  }}
                >
                  <CheckCircle2 className="size-4" /> Confirm, fee {money(q.fee, { cents: true })}
                </Button>
                <Button variant="ghost" onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
              </div>
            )}
          </div>
        </>
      )}
    </Pane>
  )
}
