/**
 * Plain-language reason codes (PRD 5.1): every hold and every holdback change carries one.
 * Copy follows the PRD design principles: dollars before percentages, and no promise that a
 * release is guaranteed.
 */

import type { ReasonCode } from './types'

export interface ReasonCopy {
  title: string
  /** One or two sentences a merchant can act on. */
  body: string
  /** Whether the merchant can do something about it. */
  actionable: boolean
  tone: 'release' | 'hold' | 'raise' | 'neutral'
}

export const REASONS: Record<ReasonCode, ReasonCopy> = {
  HELD_AT_CAPTURE: {
    title: 'Held at payment',
    body: 'Part of this payment is held to cover disputes that can still arrive. It comes back as proof arrives and as time passes.',
    actionable: false,
    tone: 'hold',
  },
  AUTH_RELEASED: {
    title: 'Fraud cover released',
    body: 'The customer authenticated this payment, so fraud liability generally sits with the card issuer.',
    actionable: false,
    tone: 'release',
  },
  AUTH_MISSING: {
    title: 'Fraud cover held',
    body: 'This payment was not authenticated with 3D Secure, so its fraud cover releases with time instead of at once. Turning on 3D Secure for future payments releases this slice on day 0.',
    actionable: true,
    tone: 'hold',
  },
  DELIVERY_RELEASED: {
    title: 'Delivery cover released',
    body: 'The carrier confirmed delivery, so a "not received" dispute is unlikely to succeed.',
    actionable: false,
    tone: 'release',
  },
  DELIVERY_AWAITING_CARRIER: {
    title: 'Waiting for the carrier',
    body: 'We have your tracking number and are waiting for the carrier to confirm delivery. Delivery entered by the merchant alone does not release funds.',
    actionable: false,
    tone: 'hold',
  },
  DELIVERY_MISSING: {
    title: 'Delivery cover held',
    body: 'No tracking number yet. Add one and delivery cover releases as soon as the carrier confirms delivery.',
    actionable: true,
    tone: 'hold',
  },
  USAGE_RELEASED: {
    title: 'Product cover reduced',
    body: 'The customer used the product after buying it, which makes "not as described" and "canceled" disputes less likely.',
    actionable: false,
    tone: 'release',
  },
  REFUND_RELEASED: {
    title: 'Refund cover released',
    body: 'A refund was issued on this payment, so a "credit not processed" dispute no longer applies.',
    actionable: false,
    tone: 'release',
  },
  TIME_DECAY: {
    title: 'Releasing with time',
    body: 'Most disputes arrive in the first weeks after a payment. The remaining cover shrinks every day.',
    actionable: false,
    tone: 'release',
  },
  WINDOW_ENDED: {
    title: 'Fully released',
    body: 'This payment reached the end of its reserve window. Nothing is held.',
    actionable: false,
    tone: 'release',
  },
  SEASONING: {
    title: 'New-account pacing',
    body: "Proof on a new account's first orders releases part of its cover, rising to the full amount as verified orders build up.",
    actionable: false,
    tone: 'neutral',
  },
  RADAR_BLOCK: {
    title: 'Early release paused',
    body: 'Radar flagged this payment, so it follows the standard reserve schedule. You can appeal this decision.',
    actionable: true,
    tone: 'hold',
  },
  EARLY_FRAUD_WARNING: {
    title: 'Fraud cover raised',
    body: 'The card issuer sent an early fraud warning. Fraud cover is held in full until the window ends or the warning is resolved.',
    actionable: true,
    tone: 'raise',
  },
  DISPUTE_OPENED: {
    title: 'Held for an open dispute',
    body: 'A dispute was filed on this payment. The disputed amount comes out of your available balance as usual, and this order goes back to the standard reserve until its window ends.',
    actionable: true,
    tone: 'raise',
  },
  PROOF_REVOKED: {
    title: 'Proof withdrawn',
    body: 'A proof on this payment could not be confirmed, so the cover it released is held again from upcoming releases.',
    actionable: true,
    tone: 'raise',
  },
  KILL_SWITCH: {
    title: 'Standard schedule',
    body: 'This account is on the standard reserve schedule while Risk reviews it. Every payment releases on its standard date.',
    actionable: true,
    tone: 'hold',
  },
  ACCOUNT_FLOOR: {
    title: 'Account minimum',
    body: 'Risk sets a minimum balance held for this account, based on recent volume. It holds this even when order-level cover is lower.',
    actionable: false,
    tone: 'neutral',
  },
}

export function reasonCopy(code: ReasonCode): ReasonCopy {
  return REASONS[code]
}
