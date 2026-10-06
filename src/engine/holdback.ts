/**
 * The holdback engine (PRD section 1): prices a holdback per payment as an expected loss split
 * by dispute family, and re-prices it on every proof event and every day.
 *
 * `priceHoldback` is a pure function of (payment, events up to `day`, model, policy). Because
 * the decay curves never rise and proof only ever lowers a multiplier, the holdback can only
 * fall between adverse events (dispute, early fraud warning, revoked proof, kill switch). That
 * is the PRD's monotonic rule, and the test suite checks it on random event sequences.
 */

import { remainingShare, type RiskModel } from './model'
import { effectiveProofs, tierOf } from './proof'
import {
  DISPUTE_TYPES,
  type Cents,
  type Day,
  type DisputeType,
  type HoldbackBreakdown,
  type OrderState,
  type Payment,
  type ReasonCode,
  type ReservePolicy,
} from './types'

export interface PricingContext {
  model: RiskModel
  policy: ReservePolicy
}

export const DEFAULT_POLICY: ReservePolicy = {
  rate: 0.1,
  windowDays: 90,
  floorFixed: 0,
  floorShareOfTrailingVolume: 0,
  floorShareOfUnprovenVolume: 0,
  floorTrailingDays: 30,
}

/** The policy the pilot proposes: flat 10% for 90 days at capture, plus the unproven-volume floor. */
export const PILOT_POLICY: ReservePolicy = {
  ...DEFAULT_POLICY,
  floorShareOfUnprovenVolume: 0.3,
}

const zeroByType = (): Record<DisputeType, number> => ({
  fraud: 0,
  not_received: 0,
  not_as_described: 0,
  credit_not_processed: 0,
})

/** What the flat rolling reserve holds for a payment on a given day. */
export function flatHoldback(payment: Payment, day: Day, policy: ReservePolicy, amount = payment.amount): Cents {
  const age = day - payment.capturedDay
  if (age < 0 || age >= policy.windowDays) return 0
  return Math.round(amount * policy.rate)
}

/** Amount still exposed after refunds on or before `day`. */
export function netAmount(order: OrderState, day: Day): Cents {
  const refunded = order.proofs
    .filter((p) => p.kind === 'refund' && p.day <= day)
    .reduce((sum, p) => sum + (p.amount ?? 0), 0)
  return Math.max(0, order.payment.amount - refunded)
}

/**
 * First day this payment had verified fulfillment proof: the proof that defuses "not received"
 * for its fulfillment type (carrier delivery for physical goods, usage otherwise), at full trust.
 */
export function verifiedFulfillmentDay(order: OrderState, model: RiskModel): Day | null {
  const kind = model.types.not_received.defusedBy[order.payment.fulfillment]
  if (!kind) return null
  let first: Day | null = null
  for (const p of order.proofs) {
    if (p.kind !== kind || model.tierWeight[tierOf(p.source)][kind] < 1) continue
    if (order.adverse.some((e) => e.kind === 'proof_revoked' && e.proofId === p.id)) continue
    if (first === null || p.day < first) first = p.day
  }
  return first
}

/** Effect of the strongest proof of the kind that defuses `type`, between 0 and 1. */
export function proofEffect(order: OrderState, type: DisputeType, day: Day, model: RiskModel): number {
  const kind = model.types[type].defusedBy[order.payment.fulfillment]
  if (!kind) return 0
  const seasoning = order.payment.seasoning ?? 1
  let best = 0
  for (const proof of effectiveProofs(order, kind, day)) {
    best = Math.max(best, model.tierWeight[tierOf(proof.source)][kind])
  }
  return best * seasoning
}

export function priceHoldback(order: OrderState, day: Day, ctx: PricingContext): HoldbackBreakdown {
  const { model, policy } = ctx
  const { payment } = order
  const age = day - payment.capturedDay
  const byType = zeroByType()
  const base = { paymentId: payment.id, day, byType }

  if (age < 0) return { ...base, total: 0, flat: 0, state: 'released', reasons: [] }

  const amount = netAmount(order, day)
  const flat = flatHoldback(payment, day, policy, amount)

  if (amount === 0) return { ...base, total: 0, flat: 0, state: 'released', reasons: ['REFUND_RELEASED'] }

  if (age >= policy.windowDays) return { ...base, total: 0, flat: 0, state: 'released', reasons: ['WINDOW_ENDED'] }

  // A dispute raises the order back to the flat schedule until its window ends (PRD 1.2). The
  // disputed amount itself is debited from the available balance, as today. The PRD's first
  // draft spent the holdback on the dispute instead; the shadow backtest showed that drains the
  // collateral pool exactly when disputes spike before a merchant fails.
  if (order.adverse.some((e) => e.kind === 'dispute' && e.day <= day)) {
    for (const type of DISPUTE_TYPES) byType[type] = amount * policy.rate * model.types[type].weight
    return { ...base, total: flat, flat, state: 'disputed', reasons: ['DISPUTE_OPENED'] }
  }

  const followFlat: ReasonCode | null =
    policy.killSwitchDay !== undefined && day >= policy.killSwitchDay
      ? 'KILL_SWITCH'
      : payment.radarFlag
        ? 'RADAR_BLOCK'
        : null
  if (followFlat) {
    for (const type of DISPUTE_TYPES) byType[type] = amount * policy.rate * model.types[type].weight
    return { ...base, total: flat, flat, state: 'flat', reasons: [followFlat] }
  }

  const reasons = new Set<ReasonCode>()
  const efw = order.adverse.some((e) => e.kind === 'early_fraud_warning' && e.day <= day)
  if (order.adverse.some((e) => e.kind === 'proof_revoked' && e.day <= day)) reasons.add('PROOF_REVOKED')

  for (const type of DISPUTE_TYPES) {
    const tm = model.types[type]
    const kind = tm.defusedBy[payment.fulfillment]
    let effect = proofEffect(order, type, day, model)
    let decays = effect > 0 || !kind || tm.withoutProof === 'decay'

    if (type === 'fraud' && efw) {
      effect = 0
      decays = false
      reasons.add('EARLY_FRAUD_WARNING')
    }

    const m = 1 - effect * (1 - tm.residualAfterProof)
    const s = decays ? remainingShare(tm.curve, age, policy.windowDays) : 1
    byType[type] = amount * policy.rate * tm.weight * m * s

    if (type === 'fraud' && !efw) reasons.add(effect > 0 ? 'AUTH_RELEASED' : 'AUTH_MISSING')
    if (kind === 'delivery') {
      if (effect > 0) reasons.add('DELIVERY_RELEASED')
      else if (effectiveProofs(order, 'delivery', day).length > 0) reasons.add('DELIVERY_AWAITING_CARRIER')
      else reasons.add('DELIVERY_MISSING')
    }
    if (kind === 'usage' && effect > 0) reasons.add('USAGE_RELEASED')
    if (kind === 'refund' && effect > 0) reasons.add('REFUND_RELEASED')
    if (decays && age > 0 && byType[type] > 0) reasons.add('TIME_DECAY')
  }

  if ((payment.seasoning ?? 1) < 1) reasons.add('SEASONING')

  const raw = DISPUTE_TYPES.reduce((sum, t) => sum + byType[t], 0)
  // Thaw never holds an order longer or harder than the flat reserve would.
  const total = Math.min(flat, Math.round(raw))
  return {
    ...base,
    total,
    flat,
    state: total > 0 ? 'held' : 'released',
    reasons: [...reasons].sort(byPriority),
  }
}

const PRIORITY: ReasonCode[] = [
  'KILL_SWITCH',
  'RADAR_BLOCK',
  'EARLY_FRAUD_WARNING',
  'PROOF_REVOKED',
  'DISPUTE_OPENED',
  'DELIVERY_MISSING',
  'DELIVERY_AWAITING_CARRIER',
  'AUTH_MISSING',
  'SEASONING',
  'AUTH_RELEASED',
  'DELIVERY_RELEASED',
  'USAGE_RELEASED',
  'REFUND_RELEASED',
  'TIME_DECAY',
  'WINDOW_ENDED',
  'HELD_AT_CAPTURE',
  'ACCOUNT_FLOOR',
]
function byPriority(a: ReasonCode, b: ReasonCode): number {
  return PRIORITY.indexOf(a) - PRIORITY.indexOf(b)
}

/** Holdback on each day from capture to the end of the window, inclusive of `fromDay`. */
export function holdbackPath(order: OrderState, ctx: PricingContext, fromDay?: Day, toDay?: Day): HoldbackBreakdown[] {
  const start = fromDay ?? order.payment.capturedDay
  const end = toDay ?? order.payment.capturedDay + ctx.policy.windowDays
  const path: HoldbackBreakdown[] = []
  for (let d = start; d <= end; d++) path.push(priceHoldback(order, d, ctx))
  return path
}

/**
 * Dollar-days (cent-days) held for one payment over its life: Σ_t H(t) for each whole day
 * from capture until the window ends.
 */
export function centDays(order: OrderState, ctx: PricingContext, mode: 'thaw' | 'flat' = 'thaw'): number {
  let total = 0
  for (let age = 0; age < ctx.policy.windowDays; age++) {
    const day = order.payment.capturedDay + age
    total += mode === 'thaw' ? priceHoldback(order, day, ctx).total : flatHoldback(order.payment, day, ctx.policy)
  }
  return total
}
