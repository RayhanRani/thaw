/**
 * The risk model: how much of a payment's dispute risk is still live on a given day, per
 * dispute family, given the evidence on that payment.
 *
 * PRD formula:   H_i(t) = A_i * Σ_k P_k(t | e_i,k) * c_k
 *
 * This engine keeps Risk's existing reserve rate as the starting point (the PRD toy model:
 * "initial holdback same as a 10% flat reserve") and factors P_k * c_k as
 *
 *   P_k(t | e) * c_k  =  r * w_k * m_k(e) * S_k(t)
 *
 *   r    reserve rate Risk already applies to the account (e.g. 10%)
 *   w_k  share of that reserve attributed to dispute family k        (weights sum to 1)
 *   m_k  evidence multiplier: 1 with no proof, `residualAfterProof` with fully trusted proof
 *   S_k  share of family-k risk still ahead on day t                 (1 at capture, 0 at window end)
 *
 * So Thaw never asks Risk to hold less at capture. It changes how fast the hold comes back.
 * All numbers in the presets below are placeholders; a backtest on Stripe's dispute data
 * would replace them.
 */

import type { DisputeType, Fulfillment, ProofKind, TrustTier } from './types'

export type DecayCurve =
  /** S(t) = 1 - t/W. The PRD toy model's "decays linearly to zero by day 90". */
  | { kind: 'linear' }
  /**
   * Weibull time-to-dispute, truncated at the window: S(t) = 1 - F(t)/F(W).
   * A stand-in for an empirical survival curve fitted on historical disputes.
   */
  | { kind: 'weibull'; shape: number; scaleDays: number }

export interface TypeModel {
  type: DisputeType
  /** Short label used in the Meter, e.g. "Fraud cover". */
  label: string
  /** w_k: share of the capture-day holdback attributed to this family. */
  weight: number
  curve: DecayCurve
  /** Which proof defuses this family, by fulfillment. null = only time defuses it. */
  defusedBy: Record<Fulfillment, ProofKind | null>
  /** m_k after fully trusted, fully seasoned proof. 0 = the proof removes the risk. */
  residualAfterProof: number
  /**
   * What happens while an applicable proof is missing:
   * - 'decay': the slice decays with time anyway (PRD toy model)
   * - 'hold':  the slice stays at the flat schedule (PRD guardrail: "missing or late proof
   *            falls back to the flat schedule, never to a faster one")
   */
  withoutProof: 'decay' | 'hold'
}

export interface RiskModel {
  version: string
  name: string
  description: string
  types: Record<DisputeType, TypeModel>
  /** How much of a proof's effect each trust tier earns, per proof kind (0 to 1). */
  tierWeight: Record<TrustTier, Record<ProofKind, number>>
  /**
   * Expected unrecovered dispute loss at capture, as a share of the amount. Used to price
   * Thaw Advance, not to size the holdback (the holdback starts at the policy rate).
   */
  expectedLossRate: number
}

const ALL_FULFILLMENT = (proof: ProofKind | null): Record<Fulfillment, ProofKind | null> => ({
  physical: proof,
  digital: proof,
  subscription: proof,
  service: proof,
})

const FULL_TRUST: Record<TrustTier, Record<ProofKind, number>> = {
  verified: { authentication: 1, delivery: 1, usage: 1, refund: 1 },
  // Trusted shipping and commerce integrations (PRD 2.5).
  trusted_partner: { authentication: 0, delivery: 0.75, usage: 0.75, refund: 0 },
  // PRD 2.2: merchant-asserted delivery alone earns no release. Merchant-posted usage
  // ("accessed", "attended") earns a little; authentication and refunds can't be asserted.
  merchant_asserted: { authentication: 0, delivery: 0, usage: 0.25, refund: 0 },
}

/**
 * The PRD appendix toy model, reproduced exactly so its numbers can be checked:
 * fraud 50%, not received 25%, other 25% (shown here as 20% not-as-described and 5% credit),
 * linear decay to day 90, authentication and carrier delivery fully defuse their slice.
 */
export const PRD_TOY_MODEL: RiskModel = {
  version: 'toy-2026-10-04',
  name: 'PRD toy model',
  description:
    'The appendix model from the PRD: linear decay to day 90, fraud and delivery slices release in full on proof.',
  types: {
    fraud: {
      type: 'fraud',
      label: 'Fraud cover',
      weight: 0.5,
      curve: { kind: 'linear' },
      defusedBy: ALL_FULFILLMENT('authentication'),
      residualAfterProof: 0,
      withoutProof: 'decay',
    },
    not_received: {
      type: 'not_received',
      label: 'Delivery cover',
      weight: 0.25,
      curve: { kind: 'linear' },
      defusedBy: { physical: 'delivery', digital: null, subscription: null, service: null },
      residualAfterProof: 0,
      withoutProof: 'decay',
    },
    not_as_described: {
      type: 'not_as_described',
      label: 'Product cover',
      weight: 0.2,
      curve: { kind: 'linear' },
      defusedBy: ALL_FULFILLMENT(null),
      residualAfterProof: 1,
      withoutProof: 'decay',
    },
    credit_not_processed: {
      type: 'credit_not_processed',
      label: 'Refund cover',
      weight: 0.05,
      curve: { kind: 'linear' },
      defusedBy: ALL_FULFILLMENT(null),
      residualAfterProof: 1,
      withoutProof: 'decay',
    },
  },
  tierWeight: FULL_TRUST,
  expectedLossRate: 0.006,
}

/**
 * The model the demo and the pilot preset use. Same weights as the toy, but:
 * - time-to-dispute follows front-loaded curves instead of a straight line,
 * - proof leaves a small residual (liability shift is not universal; delivered goods still
 *   draw some "not received" claims),
 * - usage proof counts for digital goods and subscriptions (PRD 2.3),
 * - a missing delivery proof holds its slice at the flat schedule (PRD guardrail).
 */
export const THAW_PILOT_MODEL: RiskModel = {
  version: 'thaw-0.1.0',
  name: 'Thaw pilot model',
  description:
    'Front-loaded dispute timing, small residual risk after proof, usage proof for digital and subscription, and missing delivery proof held at the flat schedule.',
  types: {
    fraud: {
      type: 'fraud',
      label: 'Fraud cover',
      weight: 0.5,
      curve: { kind: 'weibull', shape: 1.4, scaleDays: 32 },
      defusedBy: ALL_FULFILLMENT('authentication'),
      residualAfterProof: 0.04,
      withoutProof: 'decay',
    },
    not_received: {
      type: 'not_received',
      label: 'Delivery cover',
      weight: 0.25,
      curve: { kind: 'weibull', shape: 1.8, scaleDays: 30 },
      defusedBy: { physical: 'delivery', digital: 'usage', subscription: 'usage', service: 'usage' },
      residualAfterProof: 0.08,
      withoutProof: 'hold',
    },
    not_as_described: {
      type: 'not_as_described',
      label: 'Product cover',
      weight: 0.2,
      curve: { kind: 'weibull', shape: 1.5, scaleDays: 38 },
      defusedBy: { physical: null, digital: 'usage', subscription: 'usage', service: 'usage' },
      residualAfterProof: 0.45,
      withoutProof: 'decay',
    },
    credit_not_processed: {
      type: 'credit_not_processed',
      label: 'Refund cover',
      weight: 0.05,
      curve: { kind: 'weibull', shape: 1.3, scaleDays: 34 },
      defusedBy: ALL_FULFILLMENT('refund'),
      residualAfterProof: 0,
      withoutProof: 'decay',
    },
  },
  tierWeight: FULL_TRUST,
  expectedLossRate: 0.006,
}

export const MODELS: readonly RiskModel[] = [THAW_PILOT_MODEL, PRD_TOY_MODEL]

/** S_k(t): share of the family's risk still ahead at `age` days, for a window of `windowDays`. */
export function remainingShare(curve: DecayCurve, age: number, windowDays: number): number {
  if (age <= 0) return 1
  if (age >= windowDays) return 0
  switch (curve.kind) {
    case 'linear':
      return 1 - age / windowDays
    case 'weibull': {
      const cdf = (t: number) => 1 - Math.exp(-Math.pow(t / curve.scaleDays, curve.shape))
      return 1 - cdf(age) / cdf(windowDays)
    }
  }
}

export function validateModel(model: RiskModel): string[] {
  const problems: string[] = []
  const total = Object.values(model.types).reduce((s, t) => s + t.weight, 0)
  if (Math.abs(total - 1) > 1e-9) problems.push(`weights sum to ${total}, expected 1`)
  for (const t of Object.values(model.types)) {
    if (t.weight < 0) problems.push(`${t.type}: negative weight`)
    if (t.residualAfterProof < 0 || t.residualAfterProof > 1)
      problems.push(`${t.type}: residualAfterProof must be within [0, 1]`)
  }
  for (const [tier, kinds] of Object.entries(model.tierWeight)) {
    for (const [kind, w] of Object.entries(kinds)) {
      if (w < 0 || w > 1) problems.push(`${tier}.${kind}: tier weight must be within [0, 1]`)
    }
  }
  return problems
}
