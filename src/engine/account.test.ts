import { describe, expect, it } from 'vitest'
import { accountSnapshot, authenticationUpside, projectAccountReleases, projectReleases, speedUpList } from './account'
import { quoteAdvance } from './advance'
import { addBusinessDays, AppealError, decideAppeal, submitAppeal } from './appeals'
import { advanceRevenue, economics, PRD_ECONOMICS, sizingTable } from './economics'
import { orderTimeline, webhookEvents } from './explain'
import { DEFAULT_POLICY, PILOT_POLICY, priceHoldback, type PricingContext } from './holdback'
import { PRD_TOY_MODEL, THAW_PILOT_MODEL } from './model'
import { IdempotencyError, ProofApi, SimulatedCarrier } from './proof'
import { accountSeries } from './series'
import type { OrderState } from './types'

const pilot: PricingContext = { model: THAW_PILOT_MODEL, policy: DEFAULT_POLICY }

function shop(): OrderState[] {
  const orders: OrderState[] = []
  for (let d = 0; d < 60; d++) {
    for (let j = 0; j < 4; j++) {
      const id = `py_${d}_${j}`
      const proofs: OrderState['proofs'] = []
      if (j % 2 === 0) proofs.push({ id: `${id}_a`, paymentId: id, kind: 'authentication', source: 'stripe_3ds', day: d })
      if (j !== 3) proofs.push({ id: `${id}_d`, paymentId: id, kind: 'delivery', source: 'carrier', day: d + 4 })
      orders.push({ payment: { id, merchantId: 'acct', amount: 150_00, capturedDay: d, fulfillment: 'physical' }, proofs, adverse: [] })
    }
  }
  return orders
}

describe('account views', () => {
  const orders = shop()
  const today = 59

  it('holds less than the flat reserve and explains it by dispute family', () => {
    const snap = accountSnapshot(orders, today, pilot)
    expect(snap.held).toBeLessThan(snap.flatHeld)
    const sumByType = Object.values(snap.byType).reduce((a, b) => a + b, 0)
    expect(Math.abs(sumByType - snap.ordersHeld)).toBeLessThan(orders.length)
  })

  it('the unproven-volume floor raises the balance but never above the flat reserve', () => {
    const floored = accountSnapshot(orders, today, { ...pilot, policy: { ...PILOT_POLICY, floorShareOfUnprovenVolume: 0.9 } })
    expect(floored.held).toBeGreaterThanOrEqual(floored.ordersHeld)
    expect(floored.held).toBeLessThanOrEqual(floored.flatHeld)
    expect(floored.floorTopUp).toBe(floored.held - floored.ordersHeld)
  })

  it('account-level releases add up to the account balance and never go negative', () => {
    const ctx = { ...pilot, policy: PILOT_POLICY }
    const snap = accountSnapshot(orders, today, ctx)
    const days = projectAccountReleases(orders, today, ctx)
    const total = days.reduce((s, r) => s + r.total, 0)
    expect(Math.abs(total - snap.held)).toBeLessThanOrEqual(orders.length)
    for (const d of days) {
      expect(d.total).toBeGreaterThanOrEqual(0)
      const parts = d.floor + Object.values(d.byType).reduce((a, b) => a + b, 0)
      expect(Math.abs(parts - d.total)).toBeLessThan(1e-6)
    }
  })

  it('projected releases add up to what is held at the order level', () => {
    const snap = accountSnapshot(orders, today, pilot)
    const released = projectReleases(orders, today, pilot).reduce((s, r) => s + r.total, 0)
    expect(Math.abs(released - snap.ordersHeld)).toBeLessThanOrEqual(1)
  })

  it('the speed-up list finds orders missing tracking, ranked by dollars unlocked', () => {
    const list = speedUpList(orders, today, pilot)
    expect(list[0].kind).toBe('delivery')
    // every 4th order has no tracking, and this fixture sends no tracking event before the
    // carrier confirms delivery on day 4; orders under 3 days old may not have shipped yet
    expect(list[0].orderIds.length).toBe(57 + 3)
    expect(list[0].accountUnlockNow).toBeGreaterThan(0)
    expect(list[0].unlockNow).toBeGreaterThan(0)
  })

  it('3D Secure upside counts unauthenticated payments still held', () => {
    const up = authenticationUpside(orders, today, pilot)
    expect(up.orders).toBeGreaterThan(0)
    expect(up.lessHeld).toBeGreaterThan(0)
  })

  it('the fast series matches the reference snapshot', () => {
    const ctx = { ...pilot, policy: PILOT_POLICY }
    const series = accountSeries(orders, today, ctx, 0, today)
    for (const day of [10, 30, 59]) {
      const snap = accountSnapshot(orders, day, ctx)
      const pt = series.find((p) => p.day === day)!
      expect(Math.abs(pt.thaw - snap.held)).toBeLessThanOrEqual(orders.length)
      expect(pt.flat).toBe(snap.flatHeld)
    }
  })
})

describe('audit timeline', () => {
  it('logs capture, proof releases and time decay with the model version', () => {
    const o: OrderState = {
      payment: { id: 'py_1', merchantId: 'acct', amount: 100_00, capturedDay: 0, fulfillment: 'physical' },
      proofs: [
        { id: 'a', paymentId: 'py_1', kind: 'authentication', source: 'stripe_3ds', day: 0 },
        { id: 'd', paymentId: 'py_1', kind: 'delivery', source: 'carrier', day: 5, detail: 'USPS delivered' },
      ],
      adverse: [],
    }
    const ctx = { model: PRD_TOY_MODEL, policy: DEFAULT_POLICY }
    const t = orderTimeline(o, 30, ctx)
    expect(t[0]).toMatchObject({ reason: 'HELD_AT_CAPTURE', to: 10_00 })
    expect(t[1]).toMatchObject({ reason: 'AUTH_RELEASED', from: 10_00, to: 5_00 })
    expect(t.some((e) => e.reason === 'DELIVERY_RELEASED' && e.to === 2_36)).toBe(true)
    expect(t[t.length - 1]).toMatchObject({ reason: 'TIME_DECAY', to: 1_67 })
    expect(t.every((e) => e.modelVersion === PRD_TOY_MODEL.version)).toBe(true)
    expect(webhookEvents(o, 30, ctx).map((e) => e.type)).toContain('thaw.holdback.released')
  })
})

describe('Proof API', () => {
  const carrier = new SimulatedCarrier()
  carrier.register('usps', '9400100000000000000001', 1, 4)
  const payment = { id: 'py_1', merchantId: 'acct', amount: 100_00, capturedDay: 0, fulfillment: 'physical' as const }
  const api = () => new ProofApi(carrier, (id) => (id === 'py_1' ? payment : undefined))

  it('verifies delivery with the carrier', () => {
    const r = api().submit({ type: 'shipment', payment: 'py_1', carrier: 'usps', tracking_number: '9400 1000 0000 0000 0000 01' }, 'k1', 6)
    expect(r.status).toBe('verified')
    expect(r.events[0]).toMatchObject({ kind: 'delivery', source: 'carrier', day: 6 })
  })

  it('waits for the carrier when the parcel is in transit, then verifies on poll', () => {
    const a = api()
    const r = a.submit({ type: 'shipment', payment: 'py_1', carrier: 'usps', tracking_number: '9400100000000000000001' }, 'k1', 2)
    expect(r.status).toBe('pending_verification')
    expect(a.poll(3)).toEqual([])
    expect(a.poll(4)[0]).toMatchObject({ source: 'carrier', day: 4 })
  })

  it('rejects unknown tracking and earns nothing for merchant-asserted delivery', () => {
    const a = api()
    expect(a.submit({ type: 'shipment', payment: 'py_1', carrier: 'usps', tracking_number: '9400100000000000000999' }, 'k1', 6).status).toBe('rejected')
    const r = a.submit({ type: 'delivered', payment: 'py_1', occurred_day: 3 }, 'k2', 6)
    expect(r.status).toBe('accepted_low_trust')
    const o: OrderState = { payment, proofs: r.events, adverse: [] }
    const none: OrderState = { payment, proofs: [], adverse: [] }
    expect(priceHoldback(o, 10, pilot).total).toBe(priceHoldback(none, 10, pilot).total)
  })

  it('is idempotent and refuses a reused key with a different body', () => {
    const a = api()
    const body = { type: 'shipment' as const, payment: 'py_1', carrier: 'usps' as const, tracking_number: '9400100000000000000001' }
    const first = a.submit(body, 'same', 6)
    expect(a.submit(body, 'same', 9)).toBe(first)
    expect(() => a.submit({ ...body, tracking_number: '9400100000000000000002' }, 'same', 6)).toThrow(IdempotencyError)
  })
})

describe('Thaw Advance', () => {
  const orders = shop()
  const releases = projectReleases(orders, 59, pilot)

  it('offers up to a share of expected releases, with the total cost in dollars', () => {
    const q = quoteAdvance(releases, 59, 'max', { model: THAW_PILOT_MODEL, policy: DEFAULT_POLICY })
    expect(q.eligible).toBe(true)
    expect(q.maxAdvance).toBeLessThanOrEqual(q.expectedReleases)
    expect(q.totalRepayment).toBe(q.amount + q.fee)
    expect(q.fee).toBe(q.feeBreakdown.costOfFunds + q.feeBreakdown.expectedLoss + q.feeBreakdown.margin)
    const repaid = q.schedule.reduce((s, r) => s + r.toRepayment, 0)
    expect(repaid).toBeLessThanOrEqual(q.totalRepayment)
  })

  it('pauses new advances when disputes spike (PRD 4.3)', () => {
    const q = quoteAdvance(releases, 59, 'max', {
      model: THAW_PILOT_MODEL,
      policy: DEFAULT_POLICY,
      signal: { recentRate: 0.03, baselineRate: 0.01 },
    })
    expect(q.eligible).toBe(false)
  })
})

describe('appeals', () => {
  const now = new Date('2026-10-02T10:00:00Z') // a Friday

  it('sets a deadline in business days', () => {
    expect(addBusinessDays(now, 3).getUTCDay()).toBe(3) // Wednesday
  })

  it('requires a written decision, and a human above the threshold', () => {
    const appeal = submitAppeal({ merchantId: 'acct', reasonCode: 'RADAR_BLOCK', amountAtIssue: 6_000_00, statement: 'The address mismatch is a gift order.' }, now)
    expect(appeal.requiresHumanReview).toBe(true)
    expect(() => decideAppeal(appeal, { outcome: 'released', releasedAmount: 6_000_00, explanation: 'ok', reviewer: 'human' }, now)).toThrow(AppealError)
    expect(() =>
      decideAppeal(appeal, { outcome: 'released', releasedAmount: 6_000_00, explanation: 'Confirmed the gift address with the cardholder.', reviewer: 'automated' }, now),
    ).toThrow(AppealError)
    const decided = decideAppeal(
      appeal,
      { outcome: 'released', releasedAmount: 6_000_00, explanation: 'Confirmed the gift address with the cardholder.', reviewer: 'human' },
      now,
    )
    expect(decided.status).toBe('decided')
  })
})

describe('economics reproduces the PRD figures', () => {
  it('each 0.1% of $1.9T held for 120 days is about $625M', () => {
    const rows = sizingTable(1.9e12, [0.001, 0.005, 0.01], 120)
    expect(rows[0].volumeHeldPerYear).toBeCloseTo(1.9e9, -6)
    expect(rows[0].averageBalanceHeld / 1e6).toBeCloseTo(624.7, 0)
    expect(rows[1].averageBalanceHeld / 1e9).toBeCloseTo(3.12, 1)
    expect(rows[2].averageBalanceHeld / 1e9).toBeCloseTo(6.25, 1)
  })

  it('advance revenue V*h*a*f is $95M a year', () => {
    expect(advanceRevenue(1.9e12, 0.005, 0.5, 0.02)).toBeCloseTo(95e6, -3)
    expect(economics(PRD_ECONOMICS).advanceFees).toBeCloseTo(95e6, -3)
  })
})
