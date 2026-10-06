/**
 * Allocation-free holdback paths for the backtest, which prices hundreds of thousands of
 * payments for every day of their window. `priceHoldback` is the reference implementation;
 * fastpath.test.ts checks that both agree to the cent on random orders.
 *
 * Paths are returned per unit of reserve rate (cents held / r), because every term of the
 * holdback scales with r. The backtest prices each payment once and then evaluates any
 * reserve rate by multiplication.
 */

import { remainingShare, type RiskModel } from './model'
import { tierOf } from './proof'
import { DISPUTE_TYPES, type DisputeType, type OrderState, type ReservePolicy } from './types'

export type CurveTables = Record<DisputeType, Float64Array>

export function curveTables(model: RiskModel, windowDays: number): CurveTables {
  const make = (t: DisputeType) => {
    const arr = new Float64Array(windowDays + 1)
    for (let a = 0; a <= windowDays; a++) arr[a] = remainingShare(model.types[t].curve, a, windowDays)
    return arr
  }
  return {
    fraud: make('fraud'),
    not_received: make('not_received'),
    not_as_described: make('not_as_described'),
    credit_not_processed: make('credit_not_processed'),
  }
}

const MAX_INTERVALS = 8

/**
 * Fills `out[age]` for age 0..windowDays-1 with the holdback divided by the reserve rate.
 * Returns the first age at which a full refund ends the hold, or the window length.
 */
export function unitHoldbackPath(
  order: OrderState,
  model: RiskModel,
  policy: ReservePolicy,
  tables: CurveTables,
  out: Float64Array,
): number {
  const W = policy.windowDays
  const p = order.payment
  const c = p.capturedDay
  const seasoning = p.seasoning ?? 1

  let disputeAge = Infinity
  let efwAge = Infinity
  for (const e of order.adverse) {
    const age = Math.max(0, e.day - c)
    if (e.kind === 'dispute') disputeAge = Math.min(disputeAge, age)
    else if (e.kind === 'early_fraud_warning') efwAge = Math.min(efwAge, age)
  }
  const killAge = policy.killSwitchDay !== undefined ? policy.killSwitchDay - c : Infinity

  // Per dispute family: constants and the intervals during which a proof is in effect.
  const weight = new Float64Array(4)
  const residual = new Float64Array(4)
  const holdsWithoutProof = new Uint8Array(4)
  const curves: Float64Array[] = []
  const ivStart = new Float64Array(4 * MAX_INTERVALS)
  const ivEnd = new Float64Array(4 * MAX_INTERVALS)
  const ivWeight = new Float64Array(4 * MAX_INTERVALS)
  const ivCount = new Uint8Array(4)
  let refundAges: number[] | null = null
  let refundAmounts: number[] | null = null

  for (let k = 0; k < 4; k++) {
    const tm = model.types[DISPUTE_TYPES[k]]
    weight[k] = tm.weight
    residual[k] = tm.residualAfterProof
    holdsWithoutProof[k] = tm.defusedBy[p.fulfillment] !== null && tm.withoutProof === 'hold' ? 1 : 0
    curves.push(tables[DISPUTE_TYPES[k]])
  }
  for (const proof of order.proofs) {
    const age = proof.day - c
    if (proof.kind === 'refund') {
      ;(refundAges ??= []).push(age)
      ;(refundAmounts ??= []).push(proof.amount ?? 0)
    }
    for (let k = 0; k < 4; k++) {
      if (model.types[DISPUTE_TYPES[k]].defusedBy[p.fulfillment] !== proof.kind) continue
      const w = model.tierWeight[tierOf(proof.source)][proof.kind] * seasoning
      if (w <= 0 || ivCount[k] >= MAX_INTERVALS) continue
      let end = Infinity
      for (const e of order.adverse) if (e.kind === 'proof_revoked' && e.proofId === proof.id) end = Math.min(end, e.day - c)
      const i = k * MAX_INTERVALS + ivCount[k]++
      ivStart[i] = age
      ivEnd[i] = end
      ivWeight[i] = w
    }
  }

  let stopAge = W
  for (let a = 0; a < W; a++) {
    let net = p.amount
    if (refundAges) for (let r = 0; r < refundAges.length; r++) if (refundAges[r] <= a) net -= refundAmounts![r]
    if (net <= 0) {
      out[a] = 0
      if (stopAge === W) stopAge = a
      continue
    }
    if (a >= disputeAge || a >= killAge || p.radarFlag) {
      out[a] = net
      continue
    }
    let sum = 0
    for (let k = 0; k < 4; k++) {
      let effect = 0
      const base = k * MAX_INTERVALS
      for (let i = base; i < base + ivCount[k]; i++) {
        if (ivStart[i] <= a && a < ivEnd[i] && ivWeight[i] > effect) effect = ivWeight[i]
      }
      let decays = effect > 0 || holdsWithoutProof[k] === 0
      if (k === 0 && a >= efwAge) {
        effect = 0
        decays = false
      }
      sum += weight[k] * (1 - effect * (1 - residual[k])) * (decays ? curves[k][a] : 1)
    }
    out[a] = net * sum
  }
  return stopAge
}
