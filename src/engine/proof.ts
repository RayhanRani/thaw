/**
 * Proof inputs (PRD section 2): trust tiers, carrier verification and an idempotent Proof API.
 */

import type { Day, OrderState, Payment, ProofEvent, ProofKind, ProofSource, TrustTier } from './types'

export const SOURCE_TIER: Record<ProofSource, TrustTier> = {
  stripe_3ds: 'verified',
  stripe_terminal: 'verified',
  carrier: 'verified',
  billing_meter: 'verified',
  stripe_refunds: 'verified',
  commerce_platform: 'trusted_partner',
  merchant_api: 'merchant_asserted',
}

export function tierOf(source: ProofSource): TrustTier {
  return SOURCE_TIER[source]
}

/** Proofs of a kind that are in effect on `day` (arrived on or before it and not revoked by then). */
export function effectiveProofs(order: OrderState, kind: ProofKind, day: Day): ProofEvent[] {
  const revoked = new Set(
    order.adverse
      .filter((e) => e.kind === 'proof_revoked' && e.day <= day)
      .map((e) => (e.kind === 'proof_revoked' ? e.proofId : '')),
  )
  return order.proofs.filter((p) => p.kind === kind && p.day <= day && !revoked.has(p.id))
}

// ---------------------------------------------------------------------------------------
// Carrier verification
// ---------------------------------------------------------------------------------------

export type Carrier = 'usps' | 'ups' | 'fedex' | 'dhl'

export type CarrierStatus =
  | { status: 'delivered'; deliveredDay: Day }
  | { status: 'in_transit'; expectedDay: Day }
  | { status: 'not_found' }

/** What Thaw needs from a carrier integration. Real adapters would call carrier tracking APIs. */
export interface CarrierClient {
  track(carrier: Carrier, trackingNumber: string, asOfDay: Day): CarrierStatus
}

const TRACKING_FORMATS: Record<Carrier, RegExp> = {
  usps: /^9[2-5]\d{20}$/,
  ups: /^1Z[0-9A-Z]{16}$/,
  fedex: /^\d{12}$/,
  dhl: /^\d{10}$/,
}

export function normalizeTracking(trackingNumber: string): string {
  return trackingNumber.replace(/\s+/g, '').toUpperCase()
}

export function looksLikeTracking(carrier: Carrier, trackingNumber: string): boolean {
  return TRACKING_FORMATS[carrier].test(normalizeTracking(trackingNumber))
}

/**
 * A deterministic stand-in for carrier APIs. Shipments are registered by the simulation
 * (the ground truth of what was shipped and when it arrived); anything else is not found.
 */
export class SimulatedCarrier implements CarrierClient {
  private shipments = new Map<string, { carrier: Carrier; deliveredDay: Day | null; shippedDay: Day }>()

  register(carrier: Carrier, trackingNumber: string, shippedDay: Day, deliveredDay: Day | null): void {
    this.shipments.set(normalizeTracking(trackingNumber), { carrier, deliveredDay, shippedDay })
  }

  track(carrier: Carrier, trackingNumber: string, asOfDay: Day): CarrierStatus {
    const shipment = this.shipments.get(normalizeTracking(trackingNumber))
    if (!shipment || shipment.carrier !== carrier || !looksLikeTracking(carrier, trackingNumber)) {
      return { status: 'not_found' }
    }
    if (shipment.deliveredDay !== null && shipment.deliveredDay <= asOfDay) {
      return { status: 'delivered', deliveredDay: shipment.deliveredDay }
    }
    return { status: 'in_transit', expectedDay: shipment.deliveredDay ?? shipment.shippedDay + 7 }
  }
}

// ---------------------------------------------------------------------------------------
// Proof API (PRD 2.4)
// ---------------------------------------------------------------------------------------

/** What a merchant or platform posts. Mirrors a hypothetical `POST /v1/thaw/proofs`. */
export type ProofSubmission =
  | { type: 'shipment'; payment: string; carrier: Carrier; tracking_number: string }
  | { type: 'delivered'; payment: string; occurred_day: Day }
  | { type: 'accessed' | 'attended'; payment: string; occurred_day: Day }

export interface ProofApiResult {
  id: string
  object: 'thaw.proof'
  payment: string
  status: 'verified' | 'pending_verification' | 'accepted_low_trust' | 'rejected'
  trust_tier: TrustTier
  /** Proof events this submission produced, if any. */
  events: ProofEvent[]
  message: string
}

export class IdempotencyError extends Error {
  readonly code = 'idempotency_key_reused'
}

interface PendingShipment {
  submissionId: string
  paymentId: string
  carrier: Carrier
  trackingNumber: string
}

/**
 * Accepts proof submissions with idempotency keys, verifies shipments with the carrier,
 * and turns submissions into proof events the holdback engine can price.
 */
export class ProofApi {
  private byKey = new Map<string, { body: string; result: ProofApiResult }>()
  private pending: PendingShipment[] = []
  private seq = 0

  constructor(
    private readonly carrier: CarrierClient,
    private readonly lookupPayment: (id: string) => Payment | undefined,
  ) {}

  submit(submission: ProofSubmission, idempotencyKey: string, today: Day): ProofApiResult {
    const body = JSON.stringify(submission)
    const prior = this.byKey.get(idempotencyKey)
    if (prior) {
      if (prior.body !== body) {
        throw new IdempotencyError(
          `Idempotency key "${idempotencyKey}" was already used with a different request body.`,
        )
      }
      return prior.result
    }
    const result = this.handle(submission, today)
    this.byKey.set(idempotencyKey, { body, result })
    return result
  }

  /** Re-check shipments still in transit. Call once per day; returns newly verified events. */
  poll(today: Day): ProofEvent[] {
    const verified: ProofEvent[] = []
    this.pending = this.pending.filter((p) => {
      const status = this.carrier.track(p.carrier, p.trackingNumber, today)
      if (status.status !== 'delivered') return true
      verified.push(this.deliveryEvent(p.paymentId, p.carrier, p.trackingNumber, status.deliveredDay, today))
      return false
    })
    return verified
  }

  pendingCount(): number {
    return this.pending.length
  }

  private handle(submission: ProofSubmission, today: Day): ProofApiResult {
    const id = `prf_${(++this.seq).toString().padStart(6, '0')}`
    const payment = this.lookupPayment(submission.payment)
    if (!payment) {
      return this.result(id, submission.payment, 'rejected', 'merchant_asserted', [], 'No such payment.')
    }

    if (submission.type === 'shipment') {
      const tracking = normalizeTracking(submission.tracking_number)
      if (!looksLikeTracking(submission.carrier, tracking)) {
        return this.result(id, payment.id, 'rejected', 'merchant_asserted', [],
          `That does not look like a ${submission.carrier.toUpperCase()} tracking number.`)
      }
      const status = this.carrier.track(submission.carrier, tracking, today)
      if (status.status === 'not_found') {
        return this.result(id, payment.id, 'rejected', 'merchant_asserted', [],
          'The carrier has no record of this tracking number. Nothing was released.')
      }
      if (status.status === 'delivered') {
        // Proof takes effect when Stripe learns of it, not retroactively.
        const event = this.deliveryEvent(payment.id, submission.carrier, tracking, status.deliveredDay, today)
        return this.result(id, payment.id, 'verified', 'verified', [event],
          'The carrier confirmed delivery. Delivery cover is released.')
      }
      this.pending.push({ submissionId: id, paymentId: payment.id, carrier: submission.carrier, trackingNumber: tracking })
      const shipped: ProofEvent = {
        id: `pe_shp_${payment.id}`,
        paymentId: payment.id,
        kind: 'delivery',
        source: 'merchant_api',
        day: today,
        detail: `${submission.carrier.toUpperCase()} ${tracking} in transit`,
      }
      return this.result(id, payment.id, 'pending_verification', 'merchant_asserted', [shipped],
        'Tracking saved. Delivery cover releases when the carrier confirms delivery.')
    }

    const kind: ProofKind = submission.type === 'delivered' ? 'delivery' : 'usage'
    const event: ProofEvent = {
      id: `pe_${id}`,
      paymentId: payment.id,
      kind,
      source: 'merchant_api',
      day: Math.max(submission.occurred_day, today),
      detail: `Merchant reported "${submission.type}"`,
    }
    const message =
      kind === 'delivery'
        ? 'Recorded. Delivery reported by the merchant alone does not release funds; add a tracking number so the carrier can confirm it.'
        : 'Recorded at the merchant-reported trust tier, which releases part of the product cover.'
    return this.result(id, payment.id, 'accepted_low_trust', 'merchant_asserted', [event], message)
  }

  private deliveryEvent(paymentId: string, carrier: Carrier, tracking: string, deliveredDay: Day, today: Day): ProofEvent {
    return {
      id: `pe_dlv_${paymentId}`,
      paymentId,
      kind: 'delivery',
      source: 'carrier',
      day: Math.max(deliveredDay, today),
      detail: `${carrier.toUpperCase()} ${tracking} delivered`,
    }
  }

  private result(
    id: string,
    payment: string,
    status: ProofApiResult['status'],
    tier: TrustTier,
    events: ProofEvent[],
    message: string,
  ): ProofApiResult {
    return { id, object: 'thaw.proof', payment, status, trust_tier: tier, events, message }
  }
}
