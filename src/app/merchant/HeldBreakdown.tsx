import { reasonCopy } from '../../engine'
import { money, pct } from '../lib/format'
import { useDemo } from '../state/demo'
import { Card, CardHeader, ShareBar } from '../ui'
import { FAMILY_COLOR, FAMILY_ORDER, FLOOR_COLOR } from './shared'

const FAMILY_WHY: Record<string, string> = {
  fraud: 'Payments without 3D Secure keep fraud cover longer. Authenticated payments release it on day 0.',
  not_received: 'Held until the carrier confirms delivery. Orders without tracking keep it for the full window.',
  not_as_described: 'No proof applies to physical goods, so this releases with time. Most of these disputes arrive in the first weeks.',
  credit_not_processed: 'Releases with time, and at once when you issue a refund.',
}

/** "Every number links to its reason": the held balance split by dispute family plus the account minimum. */
export function HeldBreakdown() {
  const { snapshot, ctx, policy } = useDemo()
  const rows = [
    ...FAMILY_ORDER.map((t) => ({ key: t, label: ctx.model.types[t].label, value: snapshot.byType[t], color: FAMILY_COLOR[t], why: FAMILY_WHY[t] })),
    {
      key: 'floor',
      label: 'Account minimum',
      value: snapshot.floorTopUp,
      color: FLOOR_COLOR,
      why:
        policy.floorShareOfUnprovenVolume > 0
          ? `Risk holds at least ${pct(policy.floorShareOfUnprovenVolume)} of the last ${policy.floorTrailingDays} days of orders that do not have confirmed delivery yet (${money(snapshot.unprovenVolume)} right now). Adding tracking lowers it.`
          : reasonCopy('ACCOUNT_FLOOR').body,
    },
  ]
  const total = Math.max(1, snapshot.held)
  return (
    <Card>
      <CardHeader title="Why it's held" subtitle="Every held dollar, by the risk it covers" />
      <ul className="space-y-3.5">
        {rows.map((r) => (
          <li key={r.key}>
            <div className="flex items-baseline justify-between gap-2 text-[13px]">
              <span className="inline-flex items-center gap-2 font-medium">
                <span className="size-2.5 rounded-[3px]" style={{ background: r.color }} />
                {r.label}
              </span>
              <span className="tabular font-semibold">{money(r.value)}</span>
            </div>
            <div className="mt-1">
              <ShareBar share={r.value / total} color={r.color} />
            </div>
            <p className="mt-1 text-xs text-ink-2">{r.why}</p>
          </li>
        ))}
      </ul>
    </Card>
  )
}
