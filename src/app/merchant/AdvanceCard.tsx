import { useMemo, useState } from 'react'
import { DEFAULT_ADVANCE_TERMS } from '../../engine'
import { dayLabel, money, pct } from '../lib/format'
import { useDemo } from '../state/demo'
import { Button, Callout, Card, CardHeader, Slider } from '../ui'
import { useToast } from '../ui/motion'

/** PRD 4.1-4.3: borrow against the thawing balance; total cost in dollars before acceptance. */
export function AdvanceCard() {
  const { advanceQuote, advance, advanceRepaid, acceptAdvance, today } = useDemo()
  const max = useMemo(() => advanceQuote('max'), [advanceQuote])
  const [amount, setAmount] = useState<number | null>(null)
  const chosen = Math.min(amount ?? max.maxAdvance, max.maxAdvance)
  const q = useMemo(() => advanceQuote(chosen), [advanceQuote, chosen])
  const [confirming, setConfirming] = useState(false)
  const toast = useToast()

  if (advance) {
    const left = advance.total - advanceRepaid
    return (
      <Card>
        <CardHeader title="Thaw Advance" subtitle={`Accepted ${dayLabel(advance.acceptedDay)}`} />
        <div className="grid grid-cols-3 gap-4">
          <div>
            <div className="text-[13px] text-ink-2">Advanced</div>
            <div className="text-xl font-semibold">{money(advance.amount)}</div>
          </div>
          <div>
            <div className="text-[13px] text-ink-2">Fee</div>
            <div className="text-xl font-semibold">{money(advance.fee, { cents: true })}</div>
          </div>
          <div>
            <div className="text-[13px] text-ink-2">Left to repay</div>
            <div className="text-xl font-semibold">{money(left, { cents: true })}</div>
          </div>
        </div>
        <div className="mt-3 h-2 rounded-full bg-surface-2">
          <div className="h-2 rounded-full bg-accent" style={{ width: `${(advanceRepaid / advance.total) * 100}%` }} />
        </div>
        <p className="mt-2 text-[13px] text-ink-2">
          {left <= 0
            ? 'Repaid in full from releases. Nothing else is due.'
            : `Repaid from releases of the balance held on ${dayLabel(advance.acceptedDay)}. Move the date forward to watch it net down.`}
        </p>
        {today < advance.acceptedDay && <p className="mt-1 text-xs text-muted">The demo date is before the advance was taken.</p>}
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader title="Thaw Advance" subtitle="Get cash now against what is scheduled to release. Repaid automatically from those releases." />
      {!max.eligible ? (
        <Callout tone="neutral">{max.ineligibleReason}</Callout>
      ) : (
        <>
          <Slider
            label="Amount"
            value={chosen}
            min={DEFAULT_ADVANCE_TERMS.minAdvance}
            max={max.maxAdvance}
            step={10_00}
            onChange={(v) => {
              setAmount(v)
              setConfirming(false)
            }}
            format={(v) => money(v)}
            hint={`Up to ${money(max.maxAdvance)}: ${pct(DEFAULT_ADVANCE_TERMS.maxShareOfExpectedReleases)} of the ${money(max.expectedReleases)} expected to release in the next ${DEFAULT_ADVANCE_TERMS.horizonDays} days, after expected disputes.`}
          />
          <dl className="mt-4 divide-y divide-line rounded-lg border border-line text-[13px]">
            <Row label="You receive today" value={money(q.amount, { cents: true })} strong />
            <Row label="Fee, fixed" value={money(q.fee, { cents: true })} hint={`${money(q.feeBreakdown.costOfFunds, { cents: true })} cost of funds, ${money(q.feeBreakdown.expectedLoss, { cents: true })} expected loss, ${money(q.feeBreakdown.margin, { cents: true })} margin`} />
            <Row label="Total repaid from releases" value={money(q.totalRepayment, { cents: true })} strong />
            <Row label="Expected paid off" value={q.expectedPaidOffDay ? dayLabel(q.expectedPaidOffDay) : 'After the 60-day horizon'} />
          </dl>
          <p className="mt-2 text-xs text-muted">
            Each release goes to repayment until the total is repaid. If disputes draw on held funds and releases fall short, the rest comes from future payouts. No interest accrues and there is no other charge. Commercial financing disclosures would appear here where required.
          </p>
          <div className="mt-3 flex items-center gap-2">
            {!confirming ? (
              <Button variant="primary" onClick={() => setConfirming(true)}>
                Review offer
              </Button>
            ) : (
              <>
                <Button
                  variant="primary"
                  onClick={() => {
                    acceptAdvance(chosen)
                    toast({ title: `${money(q.amount)} is on its way`, body: `Repaid from scheduled releases. Fixed fee ${money(q.fee, { cents: true })}.`, tone: 'good' })
                  }}
                >
                  Accept {money(q.amount)} for a {money(q.fee, { cents: true })} fee
                </Button>
                <Button variant="ghost" onClick={() => setConfirming(false)}>
                  Not now
                </Button>
              </>
            )}
          </div>
        </>
      )}
    </Card>
  )
}

function Row({ label, value, hint, strong }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 px-3 py-2">
      <dt className="text-ink-2">
        {label}
        {hint && <div className="text-xs text-muted">{hint}</div>}
      </dt>
      <dd className={strong ? 'tabular font-semibold' : 'tabular'}>{value}</dd>
    </div>
  )
}
