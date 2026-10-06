/**
 * Core domain types for the Thaw holdback engine.
 *
 * Conventions
 * - Money is in minor units (cents), as in Stripe's API. Holdbacks are rounded to the cent.
 * - Time is measured in whole days. A payment's age is `day - payment.capturedDay`.
 * - Everything in this folder is pure TypeScript with no UI or I/O dependencies, so the same
 *   code runs in the merchant demo, the shadow backtest, and the test suite.
 */

export type Cents = number
export type Day = number

/** The four dispute families from the PRD's "Core insight" table. */
export type DisputeType = 'fraud' | 'not_received' | 'not_as_described' | 'credit_not_processed'

export const DISPUTE_TYPES: readonly DisputeType[] = [
  'fraud',
  'not_received',
  'not_as_described',
  'credit_not_processed',
] as const

/** Proof that defuses one dispute family. */
export type ProofKind = 'authentication' | 'delivery' | 'usage' | 'refund'

/** Where a proof came from. The source decides its trust tier. */
export type ProofSource =
  | 'stripe_3ds' // authentication result attached to the payment
  | 'stripe_terminal' // chip / contactless read
  | 'carrier' // delivery verified directly with the carrier
  | 'commerce_platform' // trusted integration (P2)
  | 'billing_meter' // Stripe Billing meter events
  | 'stripe_refunds' // Refunds API
  | 'merchant_api' // merchant-asserted via the Proof API

export type TrustTier = 'verified' | 'trusted_partner' | 'merchant_asserted'

export type Fulfillment = 'physical' | 'digital' | 'subscription' | 'service'

export interface Payment {
  id: string
  merchantId: string
  amount: Cents
  capturedDay: Day
  fulfillment: Fulfillment
  /** Customer-facing label shown in the Meter, e.g. "Speckled mug set". */
  description?: string
  customer?: string
  /**
   * Radar can block early release on a single payment (PRD anti-gaming). When set, the
   * payment follows the flat schedule regardless of proof.
   */
  radarFlag?: RadarFlag
  /**
   * Seasoning for this payment, frozen at capture: 0 = proof earns nothing yet, 1 = proof
   * earns its full effect. A merchant's first orders release slowly (PRD anti-gaming).
   */
  seasoning?: number
}

export type RadarFlag = 'address_mismatch' | 'velocity' | 'elevated_risk'

export interface ProofEvent {
  id: string
  paymentId: string
  kind: ProofKind
  source: ProofSource
  /** Day the proof became effective (for delivery: the day the carrier confirmed it). */
  day: Day
  /** For refunds: amount refunded. */
  amount?: Cents
  /** Human-readable detail, e.g. "USPS 9400 1000 ... delivered". */
  detail?: string
}

/** Events that may raise a holdback again (PRD 1.2): a dispute, a fraud signal, or a revoked proof. */
export type AdverseEvent =
  | { kind: 'dispute'; paymentId: string; day: Day; disputeType: DisputeType; amount: Cents }
  | { kind: 'early_fraud_warning'; paymentId: string; day: Day }
  | { kind: 'proof_revoked'; paymentId: string; day: Day; proofId: string; detail?: string }

/** Everything the engine knows about one payment. Events after the evaluation day are ignored. */
export interface OrderState {
  payment: Payment
  proofs: ProofEvent[]
  adverse: AdverseEvent[]
}

/** Account-level reserve policy, set by Risk. */
export interface ReservePolicy {
  /** Flat reserve rate the account is under today, e.g. 0.10. Thaw starts every order here. */
  rate: number
  /** Flat reserve window in days, e.g. 90. No order is ever held past this. */
  windowDays: number
  /**
   * Risk-set floor (PRD 1.3): the account always holds at least
   * max(floorFixed, floorShareOfTrailingVolume * volume over the trailing floorTrailingDays).
   */
  floorFixed: Cents
  floorShareOfTrailingVolume: number
  /**
   * Share of recent payments (inside floorTrailingDays) that still lack verified fulfillment
   * proof. The shadow backtest found this floor is what keeps loss at parity: when a merchant
   * fails, the disputes that hurt come from orders that were never fulfilled.
   */
  floorShareOfUnprovenVolume: number
  floorTrailingDays: number
  /** Optional hard cap on the account's total held balance. */
  cap?: Cents
  /** Kill switch (PRD safety): from this day on, every order follows the flat schedule. */
  killSwitchDay?: Day
}

export interface HoldbackBreakdown {
  paymentId: string
  day: Day
  /** Holdback in cents, rounded. */
  total: Cents
  /** Unrounded holdback per dispute family, in cents. */
  byType: Record<DisputeType, number>
  /** What the flat reserve would hold for this payment on the same day. */
  flat: Cents
  state: HoldbackState
  /** Why the holdback is what it is today, most important first. */
  reasons: ReasonCode[]
}

export type HoldbackState =
  | 'held' // part or all of the holdback is still held
  | 'released' // fully released
  | 'disputed' // a dispute is open or was filed; held at the flat schedule until the window ends
  | 'flat' // following the flat schedule (kill switch or Radar block)

export type ReasonCode =
  | 'HELD_AT_CAPTURE'
  | 'AUTH_RELEASED'
  | 'AUTH_MISSING'
  | 'DELIVERY_RELEASED'
  | 'DELIVERY_AWAITING_CARRIER'
  | 'DELIVERY_MISSING'
  | 'USAGE_RELEASED'
  | 'REFUND_RELEASED'
  | 'TIME_DECAY'
  | 'WINDOW_ENDED'
  | 'SEASONING'
  | 'RADAR_BLOCK'
  | 'EARLY_FRAUD_WARNING'
  | 'DISPUTE_OPENED'
  | 'PROOF_REVOKED'
  | 'KILL_SWITCH'
  | 'ACCOUNT_FLOOR'
