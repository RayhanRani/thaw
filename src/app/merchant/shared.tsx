import { DISPUTE_TYPES, knownAsOf, priceHoldback, type DisputeType, type HoldbackBreakdown, type OrderState, type PricingContext, type ReasonCode } from '../../engine'
import { Badge, type Tone } from '../ui'

export const FAMILY_COLOR: Record<DisputeType, string> = {
  fraud: 'var(--s1)',
  not_received: 'var(--s2)',
  not_as_described: 'var(--s3)',
  credit_not_processed: 'var(--s4)',
}

export const FLOOR_COLOR = 'var(--floor)'

export const FAMILY_ORDER: DisputeType[] = [...DISPUTE_TYPES]

export function priceNow(order: OrderState, today: number, ctx: PricingContext): HoldbackBreakdown {
  return priceHoldback(knownAsOf(order, today), today, ctx)
}

const STATUS: Partial<Record<ReasonCode, { label: string; tone: Tone }>> = {
  KILL_SWITCH: { label: 'Standard schedule', tone: 'neutral' },
  RADAR_BLOCK: { label: 'Radar hold', tone: 'critical' },
  EARLY_FRAUD_WARNING: { label: 'Fraud warning', tone: 'critical' },
  PROOF_REVOKED: { label: 'Proof withdrawn', tone: 'critical' },
  DISPUTE_OPENED: { label: 'Disputed', tone: 'critical' },
  DELIVERY_MISSING: { label: 'Needs tracking', tone: 'warn' },
  DELIVERY_AWAITING_CARRIER: { label: 'In transit', tone: 'accent' },
}

/** Orders this young may not have shipped yet, so missing tracking is not a problem. */
export const SHIPPING_GRACE_DAYS = 3

export function statusOf(b: HoldbackBreakdown, ageDays = Infinity): { label: string; tone: Tone } {
  if (b.state === 'disputed') return { label: 'Disputed', tone: 'critical' }
  if (b.total === 0) return { label: 'Released', tone: 'good' }
  for (const r of b.reasons) {
    if (r === 'DELIVERY_MISSING' && ageDays < SHIPPING_GRACE_DAYS) return { label: 'Not shipped yet', tone: 'neutral' }
    const s = STATUS[r]
    if (s) return s
  }
  return { label: 'Thawing', tone: 'good' }
}

export function StatusBadge({ b, ageDays }: { b: HoldbackBreakdown; ageDays?: number }) {
  const s = statusOf(b, ageDays)
  return (
    <Badge tone={s.tone} dot>
      {s.label}
    </Badge>
  )
}
