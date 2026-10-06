import { ArrowLeft, ArrowRight, Check, Clock, CreditCard, PackageCheck, RotateCcw, ShieldCheck } from 'lucide-react'
import { useState, type KeyboardEvent } from 'react'
import { DEFAULT_POLICY, PRD_TOY_MODEL, priceHoldback, type OrderState } from '../../engine'
import { money } from '../lib/format'
import { Button, Compare, cx } from '../ui'
import { AnimatedNumber } from '../ui/motion'

const ORDER: OrderState = {
  payment: { id: 'py_1042', merchantId: 'acct_demo', amount: 100_00, capturedDay: 0, fulfillment: 'physical' },
  proofs: [
    { id: 'a', paymentId: 'py_1042', kind: 'authentication', source: 'stripe_3ds', day: 0 },
    { id: 'd', paymentId: 'py_1042', kind: 'delivery', source: 'carrier', day: 5 },
  ],
  adverse: [],
}
const ctx = { model: PRD_TOY_MODEL, policy: DEFAULT_POLICY }
const RESERVE = 10_00

/** The PRD's worked example, priced by the engine: one $100 order, one proof at a time. */
const STEPS = [
  { day: 0, icon: CreditCard, short: 'Paid', title: 'Order paid', body: 'Thaw starts with the same 10% hold as today’s reserve: $10 of this $100 sale.', held: RESERVE },
  { day: 0, icon: ShieldCheck, short: 'Verified', title: 'Payment verified', body: '3D Secure proves the real cardholder paid, so the part held against fraud comes back.', held: priceHoldback(ORDER, 0, ctx).total },
  { day: 5, icon: PackageCheck, short: 'Delivered', title: 'Delivery confirmed', body: 'The carrier confirms delivery, so the part held against “it never arrived” comes back.', held: priceHoldback(ORDER, 5, ctx).total },
  { day: 30, icon: Clock, short: '1 month', title: 'A month passes', body: 'Most disputes have already arrived by now, so what’s left keeps shrinking every day.', held: priceHoldback(ORDER, 30, ctx).total },
  { day: 90, icon: Check, short: '3 months', title: 'Three months pass', body: 'Everything is back. Today’s reserve only lets go of its $10 now.', held: priceHoldback(ORDER, 90, ctx).total },
]

export function OrderStepper() {
  const [at, setAt] = useState(0)
  const step = STEPS[at]
  const last = STEPS.length - 1
  const releasedNow = at > 0 ? STEPS[at - 1].held - step.held : 0
  const today = step.day < 90 ? RESERVE : 0
  const go = (n: number) => setAt(Math.max(0, Math.min(last, n)))
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight') go(at + 1)
    if (e.key === 'ArrowLeft') go(at - 1)
  }

  return (
    <div className="card overflow-hidden" onKeyDown={onKey}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-4 sm:px-8">
        <div className="flex items-center gap-3">
          <span className="t-label">Order #1042</span>
          <span className="text-[15px] font-medium text-ink">Speckled mug set</span>
        </div>
        <span className="tabular text-[15px] font-semibold text-ink">$100.00 sale</span>
      </div>

      {/* The stepper: click any stop, or use the arrow keys. */}
      <div className="px-6 pt-8 sm:px-8">
        <ol className="relative grid grid-cols-5" aria-label="Steps">
          <span className="absolute left-[10%] right-[10%] top-5 h-px bg-line-2" aria-hidden />
          <span
            className="absolute left-[10%] top-5 h-px bg-gradient-to-r from-sky-400 to-emerald-300 transition-[width] duration-500"
            style={{ width: `${(at / last) * 80}%` }}
            aria-hidden
          />
          {STEPS.map((s, i) => {
            const done = i <= at
            return (
              <li key={s.short} className="relative flex justify-center">
                <button
                  onClick={() => go(i)}
                  aria-current={i === at ? 'step' : undefined}
                  className="group flex flex-col items-center gap-2.5 rounded-xl px-1 pb-1"
                >
                  <span
                    className={cx(
                      'relative flex size-10 items-center justify-center rounded-full border transition-all duration-300',
                      done ? 'border-sky-300/40 bg-[#0f2236] text-sky-300' : 'border-line-2 bg-surface-2 text-muted group-hover:border-sky-300/30 group-hover:text-ink-2',
                      i === at && 'glow-ice ring-4 ring-sky-400/15',
                    )}
                  >
                    <s.icon className="size-[18px]" />
                  </span>
                  <span className={cx('text-center text-[13px] font-medium leading-tight sm:text-[14px]', i === at ? 'text-ink' : 'text-ink-2')}>{s.short}</span>
                  <span className="hidden text-[12px] text-muted sm:block">Day {s.day}</span>
                </button>
              </li>
            )
          })}
        </ol>
      </div>

      <div className="grid gap-6 p-6 sm:p-8 md:grid-cols-2 md:gap-10">
        <div className="flex flex-col">
          <div className="t-label">
            Step {at + 1} of {STEPS.length} · Day {step.day}
          </div>
          <div key={at} className="animate-fade-up">
            <div className="mt-3 text-[26px] font-semibold tracking-[-0.02em] text-ink">{step.title}</div>
            <p className="t-body mt-2 max-w-[440px]">{step.body}</p>
            <div className="mt-5 h-8">
              {releasedNow > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-good-soft px-3 py-1.5 text-[14px] font-semibold text-good-ink">
                  +{money(releasedNow, { cents: true })} back to the merchant
                </span>
              )}
            </div>
          </div>
          <div className="mt-auto flex items-center gap-2 pt-6">
            <Button size="sm" onClick={() => go(at - 1)} disabled={at === 0}>
              <ArrowLeft className="size-4" /> Back
            </Button>
            {at < last ? (
              <Button size="sm" variant="primary" onClick={() => go(at + 1)}>
                Next step <ArrowRight className="size-4" />
              </Button>
            ) : (
              <Button size="sm" variant="primary" onClick={() => go(0)}>
                <RotateCcw className="size-4" /> Start over
              </Button>
            )}
          </div>
        </div>

        <div className="panel p-6">
          <div className="t-label">Held for this order</div>
          <div className="mt-3 flex items-baseline gap-3">
            <span className="t-figure text-gradient">
              <AnimatedNumber value={step.held} format={(v) => money(v, { cents: true })} duration={600} />
            </span>
            <span className="text-[15px] text-ink-2">with Thaw</span>
          </div>
          <Compare
            className="mt-7"
            max={RESERVE}
            rows={[
              { name: 'Today', value: today, text: money(today, { cents: true }) },
              { name: 'Thaw', value: step.held, text: <AnimatedNumber value={step.held} format={(v) => money(v, { cents: true })} duration={600} />, thaw: true },
            ]}
          />
          <div className="mt-6 flex items-center justify-between border-t border-line pt-5 text-[15px]">
            <span className="text-ink-2">Back with the merchant</span>
            <span className="tabular font-semibold text-good-ink">
              <AnimatedNumber value={RESERVE - step.held} format={(v) => money(v, { cents: true })} duration={600} />
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
