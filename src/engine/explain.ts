/**
 * Explainability and audit (PRD 3.2, 5.1 and the auditability requirement): every change to
 * an order's holdback, with its reason code, inputs and model version.
 */

import { knownAsOf } from './account'
import { netAmount, priceHoldback, proofEffect, type PricingContext } from './holdback'
import { reasonCopy } from './reasons'
import type { Cents, Day, OrderState, ReasonCode } from './types'

export interface AuditInputs {
  authenticated: boolean
  delivery: 'verified' | 'awaiting_carrier' | 'missing' | 'not_applicable'
  usage: 'verified' | 'reported' | 'none' | 'not_applicable'
  refunded: Cents
  seasoning: number
  radarFlag: string | null
}

export interface TimelineEntry {
  /** First day of the change. For time decay, the span ends at `toDay`. */
  day: Day
  toDay?: Day
  kind: 'capture' | 'proof' | 'adverse' | 'decay' | 'policy' | 'window_end'
  from: Cents
  to: Cents
  reason: ReasonCode
  detail: string
  modelVersion: string
  inputs: AuditInputs
}

export function auditInputs(order: OrderState, day: Day, ctx: PricingContext): AuditInputs {
  const known = knownAsOf(order, day)
  const f = order.payment.fulfillment
  const deliveryApplies = ctx.model.types.not_received.defusedBy[f] === 'delivery'
  const usageApplies = Object.values(ctx.model.types).some((t) => t.defusedBy[f] === 'usage')
  const hasDeliveryClaim = known.proofs.some((p) => p.kind === 'delivery')
  const deliveryVerified = deliveryApplies && proofEffect(known, 'not_received', day, ctx.model) > 0
  const usage = known.proofs.filter((p) => p.kind === 'usage')
  return {
    authenticated: known.proofs.some((p) => p.kind === 'authentication'),
    delivery: !deliveryApplies ? 'not_applicable' : deliveryVerified ? 'verified' : hasDeliveryClaim ? 'awaiting_carrier' : 'missing',
    usage: !usageApplies ? 'not_applicable' : usage.some((p) => p.source !== 'merchant_api') ? 'verified' : usage.length ? 'reported' : 'none',
    refunded: order.payment.amount - netAmount(known, day),
    seasoning: order.payment.seasoning ?? 1,
    radarFlag: order.payment.radarFlag ?? null,
  }
}

/** Day-by-day history of one order's holdback, collapsed into events and decay spans. */
export function orderTimeline(order: OrderState, asOfDay: Day, ctx: PricingContext): TimelineEntry[] {
  const known = knownAsOf(order, asOfDay)
  const { payment } = order
  const version = ctx.model.version
  const capture = payment.capturedDay
  if (asOfDay < capture) return []

  const H = (d: Day) => priceHoldback(known, d, ctx)
  const flatAtCapture = Math.round(payment.amount * ctx.policy.rate)
  const entries: TimelineEntry[] = [
    {
      day: capture,
      kind: 'capture',
      from: 0,
      to: flatAtCapture,
      reason: 'HELD_AT_CAPTURE',
      detail: `Held ${pct(ctx.policy.rate)} of the payment, the account's reserve rate.`,
      modelVersion: version,
      inputs: auditInputs(order, capture, ctx),
    },
  ]

  // Days on which something happened, besides the passage of time.
  const eventDays = new Set<Day>([capture])
  for (const p of known.proofs) eventDays.add(Math.max(p.day, capture))
  for (const e of known.adverse) eventDays.add(Math.max(e.day, capture))
  const kill = ctx.policy.killSwitchDay
  if (kill !== undefined && kill > capture && kill <= asOfDay) eventDays.add(kill)
  const windowEnd = capture + ctx.policy.windowDays
  if (windowEnd <= asOfDay) eventDays.add(windowEnd)
  const days = [...eventDays].filter((d) => d <= asOfDay).sort((a, b) => a - b)

  let level = flatAtCapture
  let lastDay = capture
  for (const d of days) {
    if (d > capture) {
      const before = H(d - 1).total
      if (before !== level) {
        entries.push(decayEntry(lastDay, d - 1, level, before, version, auditInputs(order, d - 1, ctx)))
      }
      level = before
    }
    const after = H(d)
    if (after.total !== level || d === capture) {
      const { kind, reason, detail } = describeEvent(known, d, after.reasons, ctx)
      if (after.total !== level) {
        entries.push({ day: d, kind, from: level, to: after.total, reason, detail, modelVersion: version, inputs: auditInputs(order, d, ctx) })
      }
    }
    level = after.total
    lastDay = d
  }
  const now = H(asOfDay).total
  if (now !== level) entries.push(decayEntry(lastDay, asOfDay, level, now, version, auditInputs(order, asOfDay, ctx)))
  return entries
}

function decayEntry(from: Day, to: Day, a: Cents, b: Cents, version: string, inputs: AuditInputs): TimelineEntry {
  return {
    day: from + 1 <= to ? from + 1 : to,
    toDay: to,
    kind: 'decay',
    from: a,
    to: b,
    reason: 'TIME_DECAY',
    detail: reasonCopy('TIME_DECAY').body,
    modelVersion: version,
    inputs,
  }
}

function describeEvent(
  order: OrderState,
  day: Day,
  reasons: ReasonCode[],
  ctx: PricingContext,
): { kind: TimelineEntry['kind']; reason: ReasonCode; detail: string } {
  const adverse = order.adverse.filter((e) => e.day === day)
  const proofs = order.proofs.filter((p) => Math.max(p.day, order.payment.capturedDay) === day)
  if (ctx.policy.killSwitchDay === day) return { kind: 'policy', reason: 'KILL_SWITCH', detail: reasonCopy('KILL_SWITCH').body }
  if (day === order.payment.capturedDay + ctx.policy.windowDays)
    return { kind: 'window_end', reason: 'WINDOW_ENDED', detail: reasonCopy('WINDOW_ENDED').body }
  for (const e of adverse) {
    if (e.kind === 'dispute') return { kind: 'adverse', reason: 'DISPUTE_OPENED', detail: `${labelDispute(e.disputeType)} dispute opened for ${money(e.amount)}.` }
    if (e.kind === 'early_fraud_warning') return { kind: 'adverse', reason: 'EARLY_FRAUD_WARNING', detail: reasonCopy('EARLY_FRAUD_WARNING').body }
    if (e.kind === 'proof_revoked') return { kind: 'adverse', reason: 'PROOF_REVOKED', detail: e.detail ?? reasonCopy('PROOF_REVOKED').body }
  }
  const proof = proofs[0]
  if (proof) {
    const reason: ReasonCode =
      proof.kind === 'authentication'
        ? 'AUTH_RELEASED'
        : proof.kind === 'delivery'
          ? proof.source === 'merchant_api'
            ? 'DELIVERY_AWAITING_CARRIER'
            : 'DELIVERY_RELEASED'
          : proof.kind === 'usage'
            ? 'USAGE_RELEASED'
            : 'REFUND_RELEASED'
    return { kind: 'proof', reason, detail: proof.detail ?? reasonCopy(reason).body }
  }
  return { kind: 'decay', reason: reasons[0] ?? 'TIME_DECAY', detail: reasonCopy(reasons[0] ?? 'TIME_DECAY').body }
}

/** PRD 3.4: webhook events a merchant integration would receive. */
export interface ThawWebhookEvent {
  id: string
  type: 'thaw.holdback.released' | 'thaw.holdback.increased' | 'thaw.holdback.created'
  day: Day
  data: { payment: string; amount_changed: Cents; holdback: Cents; reason: ReasonCode; model_version: string }
}

export function webhookEvents(order: OrderState, asOfDay: Day, ctx: PricingContext): ThawWebhookEvent[] {
  return orderTimeline(order, asOfDay, ctx)
    .filter((e) => e.kind !== 'decay')
    .map((e, i) => ({
      id: `evt_${order.payment.id}_${i}`,
      type: e.kind === 'capture' ? 'thaw.holdback.created' : e.to < e.from ? 'thaw.holdback.released' : 'thaw.holdback.increased',
      day: e.day,
      data: {
        payment: order.payment.id,
        amount_changed: e.to - e.from,
        holdback: e.to,
        reason: e.reason,
        model_version: e.modelVersion,
      },
    }))
}

function pct(x: number): string {
  return `${Math.round(x * 1000) / 10}%`
}

function money(cents: Cents): string {
  return `$${(cents / 100).toFixed(2)}`
}

function labelDispute(t: string): string {
  return t.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
}
