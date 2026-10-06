import { describe, expect, it } from 'vitest'
import { centDays, DEFAULT_POLICY, priceHoldback, type PricingContext } from './holdback'
import { PRD_TOY_MODEL, THAW_PILOT_MODEL, remainingShare, validateModel } from './model'
import { mulberry32 } from './random'
import type { AdverseEvent, OrderState, ProofEvent } from './types'

const toy: PricingContext = { model: PRD_TOY_MODEL, policy: DEFAULT_POLICY }
const pilot: PricingContext = { model: THAW_PILOT_MODEL, policy: DEFAULT_POLICY }

function order(opts: {
  amount?: number
  authenticated?: boolean
  deliveredDay?: number
  fulfillment?: OrderState['payment']['fulfillment']
  proofs?: ProofEvent[]
  adverse?: AdverseEvent[]
  seasoning?: number
  radar?: boolean
}): OrderState {
  const id = 'py_test'
  const proofs: ProofEvent[] = [...(opts.proofs ?? [])]
  if (opts.authenticated) proofs.push({ id: 'pe_auth', paymentId: id, kind: 'authentication', source: 'stripe_3ds', day: 0 })
  if (opts.deliveredDay !== undefined)
    proofs.push({ id: 'pe_dlv', paymentId: id, kind: 'delivery', source: 'carrier', day: opts.deliveredDay })
  return {
    payment: {
      id,
      merchantId: 'acct_test',
      amount: opts.amount ?? 100_00,
      capturedDay: 0,
      fulfillment: opts.fulfillment ?? 'physical',
      seasoning: opts.seasoning,
      radarFlag: opts.radar ? 'address_mismatch' : undefined,
    },
    proofs,
    adverse: opts.adverse ?? [],
  }
}

describe('models', () => {
  it('presets are internally consistent', () => {
    expect(validateModel(PRD_TOY_MODEL)).toEqual([])
    expect(validateModel(THAW_PILOT_MODEL)).toEqual([])
  })

  it('decay curves start at 1, end at 0 and never rise', () => {
    for (const model of [PRD_TOY_MODEL, THAW_PILOT_MODEL]) {
      for (const t of Object.values(model.types)) {
        expect(remainingShare(t.curve, 0, 90)).toBe(1)
        expect(remainingShare(t.curve, 90, 90)).toBe(0)
        let prev = 1
        for (let d = 1; d <= 90; d++) {
          const s = remainingShare(t.curve, d, 90)
          expect(s).toBeLessThanOrEqual(prev)
          prev = s
        }
      }
    }
  })
})

describe('PRD worked example: $100 order, 10% flat reserve', () => {
  // PRD table: day 0 $5.00, day 5 $2.36, day 30 $1.67, day 60 $0.83, day 90 $0.00.
  const o = order({ authenticated: true, deliveredDay: 5 })
  const at = (day: number) => priceHoldback(o, day, toy).total

  it.each([
    [0, 5_00],
    [5, 2_36],
    [30, 1_67],
    [60, 83],
    [90, 0],
  ])('day %i holds %i cents', (day, cents) => {
    expect(at(day)).toBe(cents)
  })

  it('the flat reserve holds $10.00 until day 90', () => {
    expect(priceHoldback(o, 0, toy).flat).toBe(10_00)
    expect(priceHoldback(o, 89, toy).flat).toBe(10_00)
    expect(priceHoldback(o, 90, toy).flat).toBe(0)
  })

  it('an unauthenticated order keeps its fraud slice and decays more slowly', () => {
    const unauth = order({ authenticated: false, deliveredDay: 5 })
    for (const day of [0, 5, 30, 60]) {
      expect(priceHoldback(unauth, day, toy).total).toBeGreaterThan(at(day))
    }
    expect(priceHoldback(unauth, 0, toy).total).toBe(10_00)
  })
})

describe('PRD appendix: toy model result', () => {
  // 70% authenticated, 95% carrier-confirmed delivery by day 5, linear decay to day 90.
  const variants = [
    { auth: true, delivered: true, p: 0.7 * 0.95 },
    { auth: true, delivered: false, p: 0.7 * 0.05 },
    { auth: false, delivered: true, p: 0.3 * 0.95 },
    { auth: false, delivered: false, p: 0.3 * 0.05 },
  ]
  const expected = (mode: 'thaw' | 'flat') =>
    variants.reduce(
      (sum, v) =>
        sum + v.p * centDays(order({ authenticated: v.auth, deliveredDay: v.delivered ? 5 : undefined }), toy, mode),
      0,
    )

  it('cuts dollar-days held by about 78%', () => {
    const ratio = expected('thaw') / expected('flat')
    expect(ratio).toBeGreaterThan(0.21)
    expect(ratio).toBeLessThan(0.23)
  })

  it('on $100k a week, about $129k held falls to about $28k', () => {
    const ordersPerDay = 100_000 / 7 / 100 // $100 orders
    const flatHeld = (expected('flat') / 100) * ordersPerDay // steady state: daily volume x dollar-days per order
    const thawHeld = (expected('thaw') / 100) * ordersPerDay
    expect(flatHeld).toBeCloseTo(128_571, -1)
    expect(Math.abs(thawHeld - 28_000)).toBeLessThan(1_000)
  })
})

describe('proof rules', () => {
  it('merchant-asserted delivery earns no release (PRD 2.2)', () => {
    const asserted = order({
      authenticated: true,
      proofs: [{ id: 'pe_m', paymentId: 'py_test', kind: 'delivery', source: 'merchant_api', day: 3 }],
    })
    const none = order({ authenticated: true })
    const b = priceHoldback(asserted, 10, pilot)
    expect(b.total).toBe(priceHoldback(none, 10, pilot).total)
    expect(b.reasons).toContain('DELIVERY_AWAITING_CARRIER')
  })

  it('missing delivery proof holds its slice at the flat schedule in the pilot model', () => {
    const o = order({ authenticated: true })
    const b = priceHoldback(o, 60, pilot)
    expect(b.byType.not_received).toBeCloseTo(10_00 * 0.25, 6)
    expect(b.reasons[0]).toBe('DELIVERY_MISSING')
  })

  it('a new account earns part of the proof effect (seasoning)', () => {
    const seasoned = priceHoldback(order({ authenticated: true, deliveredDay: 4 }), 10, pilot).total
    const fresh = priceHoldback(order({ authenticated: true, deliveredDay: 4, seasoning: 0.5 }), 10, pilot).total
    expect(fresh).toBeGreaterThan(seasoned)
  })

  it('usage proof reduces product cover for subscriptions', () => {
    const used = order({
      fulfillment: 'subscription',
      authenticated: true,
      proofs: [{ id: 'pe_use', paymentId: 'py_test', kind: 'usage', source: 'billing_meter', day: 2 }],
    })
    const unused = order({ fulfillment: 'subscription', authenticated: true })
    const a = priceHoldback(used, 10, pilot)
    const b = priceHoldback(unused, 10, pilot)
    expect(a.byType.not_as_described).toBeLessThan(b.byType.not_as_described)
    expect(a.reasons).toContain('USAGE_RELEASED')
  })

  it('refunds release refund cover and shrink the exposed amount', () => {
    const o = order({
      authenticated: true,
      deliveredDay: 4,
      proofs: [{ id: 'pe_r', paymentId: 'py_test', kind: 'refund', source: 'stripe_refunds', day: 6, amount: 40_00 }],
    })
    expect(priceHoldback(o, 7, pilot).total).toBeLessThan(priceHoldback(o, 5, pilot).total)
    const full = order({
      proofs: [{ id: 'pe_r', paymentId: 'py_test', kind: 'refund', source: 'stripe_refunds', day: 2, amount: 100_00 }],
    })
    expect(priceHoldback(full, 2, pilot).total).toBe(0)
  })
})

describe('guardrails', () => {
  it('Radar can block early release on a single order', () => {
    const b = priceHoldback(order({ authenticated: true, deliveredDay: 3, radar: true }), 20, pilot)
    expect(b.total).toBe(b.flat)
    expect(b.reasons).toEqual(['RADAR_BLOCK'])
  })

  it('the kill switch returns the order to the flat reserve', () => {
    const o = order({ authenticated: true, deliveredDay: 3 })
    const ctx = { ...pilot, policy: { ...pilot.policy, killSwitchDay: 30 } }
    expect(priceHoldback(o, 29, ctx).total).toBeLessThan(10_00)
    expect(priceHoldback(o, 30, ctx).total).toBe(10_00)
    expect(priceHoldback(o, 90, ctx).total).toBe(0)
  })

  it('an early fraud warning raises fraud cover back to full', () => {
    const o = order({ authenticated: true, deliveredDay: 3, adverse: [{ kind: 'early_fraud_warning', paymentId: 'py_test', day: 20 }] })
    expect(priceHoldback(o, 20, pilot).byType.fraud).toBeCloseTo(5_00, 6)
    expect(priceHoldback(o, 19, pilot).byType.fraud).toBeLessThan(1_00)
  })

  it('a dispute raises the order back to the flat schedule until its window ends', () => {
    const o = order({ authenticated: true, deliveredDay: 3, adverse: [{ kind: 'dispute', paymentId: 'py_test', day: 25, disputeType: 'not_as_described', amount: 100_00 }] })
    expect(priceHoldback(o, 24, pilot).total).toBeLessThan(10_00)
    const b = priceHoldback(o, 25, pilot)
    expect(b.total).toBe(10_00)
    expect(b.state).toBe('disputed')
    expect(priceHoldback(o, 90, pilot).total).toBe(0)
  })

  it('never holds more than the flat reserve, and never rises without an adverse event', () => {
    const rand = mulberry32(42)
    for (let trial = 0; trial < 300; trial++) {
      const fulfillment = (['physical', 'digital', 'subscription', 'service'] as const)[Math.floor(rand() * 4)]
      const proofs: ProofEvent[] = []
      const kinds = ['authentication', 'delivery', 'usage', 'refund'] as const
      const sources = ['stripe_3ds', 'carrier', 'billing_meter', 'stripe_refunds', 'merchant_api', 'commerce_platform'] as const
      for (let i = 0; i < 4; i++) {
        if (rand() < 0.5) continue
        const kind = kinds[Math.floor(rand() * kinds.length)]
        proofs.push({
          id: `pe_${i}`,
          paymentId: 'py_test',
          kind,
          source: sources[Math.floor(rand() * sources.length)],
          day: Math.floor(rand() * 60),
          amount: kind === 'refund' ? Math.floor(rand() * 100_00) : undefined,
        })
      }
      const o = order({ fulfillment, proofs, seasoning: rand() < 0.3 ? 0.5 : 1 })
      for (const ctx of [toy, pilot]) {
        let prev = Infinity
        for (let d = 0; d <= 90; d++) {
          const b = priceHoldback(o, d, ctx)
          expect(b.total).toBeLessThanOrEqual(b.flat)
          expect(b.total).toBeLessThanOrEqual(prev)
          prev = b.total
        }
      }
    }
  })
})
