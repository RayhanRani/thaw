import { describe, expect, it } from 'vitest'
import { curveTables, unitHoldbackPath } from './fastpath'
import { DEFAULT_POLICY, priceHoldback } from './holdback'
import { PRD_TOY_MODEL, THAW_PILOT_MODEL } from './model'
import { mulberry32, randInt } from './random'
import type { AdverseEvent, OrderState, ProofEvent } from './types'

describe('fast path agrees with the reference engine', () => {
  for (const model of [PRD_TOY_MODEL, THAW_PILOT_MODEL]) {
    it(`matches priceHoldback to the cent (${model.name})`, () => {
      const rand = mulberry32(7)
      const out = new Float64Array(DEFAULT_POLICY.windowDays)
      const tables = curveTables(model, DEFAULT_POLICY.windowDays)
      for (let trial = 0; trial < 400; trial++) {
        const captured = randInt(rand, 0, 30)
        const proofs: ProofEvent[] = []
        const adverse: AdverseEvent[] = []
        if (rand() < 0.6) proofs.push({ id: 'a', paymentId: 'p', kind: 'authentication', source: 'stripe_3ds', day: captured })
        if (rand() < 0.6)
          proofs.push({ id: 'd', paymentId: 'p', kind: 'delivery', source: rand() < 0.8 ? 'carrier' : 'merchant_api', day: captured + randInt(rand, 1, 12) })
        if (rand() < 0.4)
          proofs.push({ id: 'u', paymentId: 'p', kind: 'usage', source: rand() < 0.7 ? 'billing_meter' : 'merchant_api', day: captured + randInt(rand, 0, 20) })
        if (rand() < 0.15)
          proofs.push({ id: 'r', paymentId: 'p', kind: 'refund', source: 'stripe_refunds', day: captured + randInt(rand, 1, 40), amount: randInt(rand, 1_00, 120_00) })
        if (rand() < 0.1) adverse.push({ kind: 'dispute', paymentId: 'p', day: captured + randInt(rand, 5, 80), disputeType: 'fraud', amount: 1 })
        if (rand() < 0.1) adverse.push({ kind: 'early_fraud_warning', paymentId: 'p', day: captured + randInt(rand, 2, 60) })
        if (rand() < 0.1 && proofs.length) adverse.push({ kind: 'proof_revoked', paymentId: 'p', day: captured + randInt(rand, 10, 70), proofId: proofs[0].id })
        const order: OrderState = {
          payment: {
            id: 'p',
            merchantId: 'm',
            amount: randInt(rand, 5_00, 400_00),
            capturedDay: captured,
            fulfillment: (['physical', 'digital', 'subscription', 'service'] as const)[randInt(rand, 0, 3)],
            seasoning: rand() < 0.3 ? 0.6 : undefined,
            radarFlag: rand() < 0.05 ? 'velocity' : undefined,
          },
          proofs,
          adverse,
        }
        const policy = rand() < 0.1 ? { ...DEFAULT_POLICY, killSwitchDay: captured + randInt(rand, 0, 60) } : DEFAULT_POLICY
        unitHoldbackPath(order, model, policy, tables, out)
        for (let a = 0; a < policy.windowDays; a++) {
          const ref = priceHoldback(order, captured + a, { model, policy }).total
          expect(Math.abs(Math.round(out[a] * policy.rate) - ref)).toBeLessThanOrEqual(1)
        }
      }
    })
  }
})
