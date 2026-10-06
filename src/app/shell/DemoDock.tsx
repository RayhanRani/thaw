import { FastForward, RotateCcw } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { accountSeries } from '../../engine'
import { DEMO_TODAY, FUTURE_DAYS } from '../demo/merchant'
import { dayLong, money } from '../lib/format'
import { useDemo } from '../state/demo'
import { buttonClass } from '../ui'
import { useToast } from '../ui/motion'

/** Presenter controls, kept out of the product UI: jump a week ahead, or start over. */
export function DemoDock() {
  const { today, setToday, reset, orders, ctx } = useDemo()
  const toast = useToast()
  const jumpedFrom = useRef<number | null>(null)
  const max = DEMO_TODAY + FUTURE_DAYS
  const offset = today - DEMO_TODAY

  // After a jump, report what actually came back from the orders that were already sold,
  // including deliveries the carrier confirmed during the week.
  useEffect(() => {
    const from = jumpedFrom.current
    if (from === null || today <= from) return
    jumpedFrom.current = null
    const cohort = orders.filter((o) => o.payment.capturedDay <= from)
    const s = accountSeries(cohort, today, ctx, from, today)
    const released = Math.max(0, s[0].thaw - s[s.length - 1].thaw)
    if (released > 0) toast({ title: `A week later: ${money(released)} came back`, body: 'Released as orders were delivered and their dispute windows passed.', tone: 'good' })
  }, [today, orders, ctx, toast])

  const nextWeek = () => {
    jumpedFrom.current = today
    setToday(Math.min(max, today + 7))
  }

  return (
    <div data-demo-dock className="pointer-events-none fixed inset-x-0 bottom-5 z-30 flex justify-center px-4">
      <div className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-line-2 bg-surface/90 py-1.5 pl-5 pr-1.5 shadow-[0_20px_50px_-15px_rgba(0,0,0,0.9)] backdrop-blur-xl">
        <div className="pr-1 leading-tight sm:pr-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Demo date</div>
          <div className="tabular whitespace-nowrap text-[14px] font-semibold text-ink">
            {dayLong(today)}
            {offset > 0 && <span className="ml-1.5 hidden font-normal text-ink-2 sm:inline">+{offset} days</span>}
          </div>
        </div>
        <button onClick={nextWeek} disabled={today >= max} className={buttonClass('primary', 'sm', 'h-10')}>
          <FastForward className="size-4" />
          <span className="whitespace-nowrap">
            <span className="sm:hidden">+1 week</span>
            <span className="hidden sm:inline">One week later</span>
          </span>
        </button>
        <button onClick={reset} className={buttonClass('ghost', 'sm', 'h-10 px-3')} title="Start the demo over">
          <RotateCcw className="size-4" /> <span className="hidden sm:inline">Reset</span>
        </button>
      </div>
    </div>
  )
}
