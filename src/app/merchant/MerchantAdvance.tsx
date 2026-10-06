import { CalendarCheck, CircleDollarSign, Repeat } from 'lucide-react'
import { PageHeader } from '../shell/AppShell'
import { Card } from '../ui'
import { AdvanceCard } from './AdvanceCard'

const STEPS = [
  { icon: CircleDollarSign, title: 'Get cash today', body: 'Borrow up to 80% of what is expected to release in the next 60 days, after expected disputes.' },
  { icon: Repeat, title: 'Repaid from releases', body: 'Each scheduled release goes to repayment until the total is repaid. Nothing comes out of new sales.' },
  { icon: CalendarCheck, title: 'One fixed fee', body: 'Priced from the same risk model as the holdback. No interest, no other charge, shown in dollars before you accept.' },
]

export function MerchantAdvance() {
  return (
    <>
      <PageHeader eyebrow="Thaw Advance" title="Don't wait for the thaw" subtitle="Turn money that is scheduled to release into cash you can use today." />
      <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
        <AdvanceCard />
        <Card>
          <div className="text-[15px] font-semibold">How it works</div>
          <ol className="mt-4 space-y-5">
            {STEPS.map((s, i) => (
              <li key={s.title} className="flex gap-3.5">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-ink">
                  <s.icon className="size-[18px]" />
                </div>
                <div>
                  <div className="text-[14px] font-semibold">
                    {i + 1}. {s.title}
                  </div>
                  <p className="mt-0.5 text-[13px] text-ink-2">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </>
  )
}
