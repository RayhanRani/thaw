import { Check, Clock, PackageCheck, ShieldCheck, Snowflake } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { DEFAULT_POLICY, PRD_TOY_MODEL, priceHoldback, type OrderState } from '../../engine'
import { money } from '../lib/format'
import { cx } from '../ui'
import { AnimatedNumber, ThawBar } from '../ui/motion'

const ORDER: OrderState = {
  payment: { id: 'py_1042', merchantId: 'acct_demo', amount: 100_00, capturedDay: 0, fulfillment: 'physical' },
  proofs: [
    { id: 'a', paymentId: 'py_1042', kind: 'authentication', source: 'stripe_3ds', day: 0 },
    { id: 'd', paymentId: 'py_1042', kind: 'delivery', source: 'carrier', day: 5 },
  ],
  adverse: [],
}

/** The PRD's worked example, animated: one $100 order thawing step by step, priced by the engine. */
export function HeroOrder() {
  const ctx = { model: PRD_TOY_MODEL, policy: DEFAULT_POLICY }
  const steps = useMemo(
    () => [
      { day: 0, icon: Snowflake, title: 'Payment captured', note: 'Held at the account’s 10% reserve', value: 10_00 },
      { day: 0, icon: ShieldCheck, title: '3D Secure verified', note: 'Fraud cover released', value: priceHoldback(ORDER, 0, ctx).total },
      { day: 5, icon: PackageCheck, title: 'Carrier confirms delivery', note: 'Delivery cover released', value: priceHoldback(ORDER, 5, ctx).total },
      { day: 30, icon: Clock, title: 'Day 30', note: 'Most disputes have already arrived', value: priceHoldback(ORDER, 30, ctx).total },
      { day: 90, icon: Check, title: 'Day 90', note: 'Fully released', value: priceHoldback(ORDER, 90, ctx).total },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  const [at, setAt] = useState(0)
  useEffect(() => {
    // Hold on the last step a little longer, then start the order over.
    const t = setTimeout(() => setAt((n) => (n + 1) % steps.length), at === steps.length - 1 ? 3200 : 1800)
    return () => clearTimeout(t)
  }, [at, steps.length])
  const step = steps[at]
  const flat = step.day < 90 ? 10_00 : 0

  return (
    <div className="card w-full max-w-[440px] p-7 shadow-2xl shadow-black/40">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-medium uppercase tracking-wider text-sky-300/80">Order #1042</div>
          <div className="mt-0.5 text-[15px] font-semibold text-white">Speckled mug set</div>
        </div>
        <div className="text-right">
          <div className="text-[15px] font-semibold text-white">$100.00</div>
          <div className="text-xs text-slate-400">Day {step.day}</div>
        </div>
      </div>

      <div className="mt-6 flex items-end justify-between gap-4">
        <div>
          <div className="text-xs text-slate-400">Held by Thaw</div>
          <div className="text-[44px] font-semibold leading-none tracking-tight text-white">
            <AnimatedNumber value={step.value} format={(v) => money(v, { cents: true })} duration={700} />
          </div>
        </div>
        <div className="pb-1 text-right">
          <div className="text-xs text-slate-400">Today's reserve</div>
          <div className="text-lg font-semibold text-slate-300">{money(flat, { cents: true })}</div>
        </div>
      </div>

      <div className="mt-4">
        <ThawBar held={step.value} total={10_00} heldLabel="Held" thawedLabel="Back with the merchant" />
      </div>

      <ol className="mt-5 space-y-1.5">
        {steps.map((s, n) => {
          const done = n <= at
          const current = n === at
          return (
            <li
              key={s.title}
              className={cx(
                'flex items-center gap-3 rounded-xl px-3 py-2 transition-all duration-500',
                current ? 'bg-sky-400/[0.07] ring-1 ring-sky-300/25' : '',
                done ? 'opacity-100' : 'opacity-35',
              )}
            >
              <span className={cx('flex size-7 shrink-0 items-center justify-center rounded-lg', done ? 'ice-tile' : 'bg-white/10 text-slate-400')}>
                <s.icon className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-white">{s.title}</div>
                <div className="text-xs text-slate-400">{s.note}</div>
              </div>
              <span className="tabular text-[13px] font-semibold text-slate-200">{money(s.value, { cents: true })}</span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
