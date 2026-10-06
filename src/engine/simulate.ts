/**
 * Synthetic payments world for the shadow backtest.
 *
 * Nothing here is Stripe data. It is a generative model with stated assumptions, built so the
 * backtest harness can run end to end before real data exists. The PRD's ask is to replace
 * this file with historical payments, proofs and disputes and run the same harness.
 *
 * Why reserves exist at all: a live merchant pays for its own disputes out of its balance.
 * Stripe loses money only when a merchant stops operating (insolvency or a bust-out) and
 * disputes keep arriving afterwards. Held funds are what cover those disputes. The world
 * below therefore models merchant failure explicitly, including merchants who game proof.
 */

import { bernoulli, lognormal, mulberry32, poisson, randInt, type Rand, weibull } from './random'
import type { Cents, Day, DisputeType, Fulfillment, OrderState, ProofEvent } from './types'

export type Category = Fulfillment
export type Region = 'US' | 'EU' | 'UK' | 'APAC'
export type AgeBand = 'new' | 'established'

export type Fate =
  | { kind: 'healthy' }
  | { kind: 'insolvent'; day: Day }
  | { kind: 'bust_out'; day: Day; gamesProof: boolean }

export interface MerchantSpec {
  id: string
  category: Category
  region: Region
  age: AgeBand
  ordersPerDay: number
  aov: Cents
  authRate: number
  /** Tracking coverage for physical goods, usage-event coverage otherwise. */
  proofRate: number
  refundRate: number
  radarRate: number
  fate: Fate
}

export interface WorldAssumptions {
  seed: number
  merchants: number
  /** Days of payments. Disputes keep arriving up to 120 days after the last payment. */
  days: number
  meanOrdersPerDay: number
  categoryMix: Record<Category, number>
  regionMix: Record<Region, number>
  newMerchantShare: number
  aovByCategory: Record<Category, Cents>
  authRateByRegion: Record<Region, [number, number]>
  proofRateByCategory: Record<Category, [number, number]>
  carrierVerifiableShare: number
  /** Chance per payment of a dispute of each type, with no evidence. */
  baseDisputeRate: Record<DisputeType, number>
  /** How evidence changes the true chance of a dispute (relative risk). */
  relativeRisk: { authenticatedFraud: number; deliveredNotReceived: number; usedNotReceived: number; usedNotAsDescribed: number }
  /** Share of a dispute's amount that is lost, by evidence. */
  lossGivenDispute: { fraudAuthenticated: number; fraudUnauthenticated: number; notReceivedWithProof: number; notReceivedNoProof: number; notAsDescribed: number; credit: number }
  /** True time from payment to dispute, by type (Weibull), in days. Deliberately not identical to the model's curves. */
  disputeDelay: Record<DisputeType, { shape: number; scaleDays: number }>
  annualInsolvency: Record<AgeBand, number>
  annualBustOut: Record<AgeBand, number>
  /** Before an insolvency, recent orders go unfulfilled. */
  insolvencyUnfulfilledDays: number
  insolvencyUnfulfilledShare: number
  /** Chance an unfulfilled order is disputed. */
  unfulfilledDisputeRate: number
  bustOutRampDays: number
  bustOutRampMultiple: number
  bustOutUnfulfilledShare: number
  /** Share of bust-outs that ship empty parcels with real tracking to game delivery proof. */
  bustOutGamesProofShare: number
  /** Seasoning for new merchants: proof effect starts here and reaches 1 after `seasoningOrders` verified orders. */
  seasoningStart: number
  seasoningOrders: number
}

export const DEFAULT_WORLD: WorldAssumptions = {
  seed: 20261004,
  merchants: 300,
  days: 365,
  meanOrdersPerDay: 6,
  categoryMix: { physical: 0.5, digital: 0.15, subscription: 0.25, service: 0.1 },
  regionMix: { US: 0.5, EU: 0.25, UK: 0.1, APAC: 0.15 },
  newMerchantShare: 0.35,
  aovByCategory: { physical: 65_00, digital: 30_00, subscription: 35_00, service: 120_00 },
  authRateByRegion: { US: [0.25, 0.65], EU: [0.85, 0.97], UK: [0.75, 0.95], APAC: [0.3, 0.7] },
  proofRateByCategory: { physical: [0.5, 0.98], digital: [0.3, 0.95], subscription: [0.4, 0.95], service: [0.1, 0.6] },
  carrierVerifiableShare: 0.93,
  baseDisputeRate: { fraud: 0.0035, not_received: 0.0025, not_as_described: 0.002, credit_not_processed: 0.0008 },
  relativeRisk: { authenticatedFraud: 0.5, deliveredNotReceived: 0.2, usedNotReceived: 0.15, usedNotAsDescribed: 0.6 },
  lossGivenDispute: {
    fraudAuthenticated: 0.05,
    fraudUnauthenticated: 0.9,
    notReceivedWithProof: 0.3,
    notReceivedNoProof: 0.85,
    notAsDescribed: 0.6,
    credit: 0.8,
  },
  disputeDelay: {
    fraud: { shape: 1.4, scaleDays: 28 },
    not_received: { shape: 1.8, scaleDays: 34 },
    not_as_described: { shape: 1.5, scaleDays: 40 },
    credit_not_processed: { shape: 1.3, scaleDays: 30 },
  },
  annualInsolvency: { new: 0.05, established: 0.02 },
  annualBustOut: { new: 0.025, established: 0.003 },
  insolvencyUnfulfilledDays: 21,
  insolvencyUnfulfilledShare: 0.75,
  unfulfilledDisputeRate: 0.3,
  bustOutRampDays: 30,
  bustOutRampMultiple: 3,
  bustOutUnfulfilledShare: 0.85,
  bustOutGamesProofShare: 0.3,
  seasoningStart: 0.5,
  seasoningOrders: 100,
}

const MAX_DISPUTE_DELAY = 120

function weighted<T extends string>(rand: Rand, mix: Record<T, number>): T {
  const entries = Object.entries(mix) as [T, number][]
  const total = entries.reduce((s, [, w]) => s + w, 0)
  let u = rand() * total
  for (const [k, w] of entries) {
    u -= w
    if (u <= 0) return k
  }
  return entries[entries.length - 1][0]
}

const uniform = (rand: Rand, [lo, hi]: [number, number]) => lo + (hi - lo) * rand()

export function generateMerchants(world: WorldAssumptions): MerchantSpec[] {
  const rand = mulberry32(world.seed)
  const specs: MerchantSpec[] = []
  for (let i = 0; i < world.merchants; i++) {
    const category = weighted(rand, world.categoryMix)
    const region = weighted(rand, world.regionMix)
    const age: AgeBand = bernoulli(rand, world.newMerchantShare) ? 'new' : 'established'
    const failDay = () => randInt(rand, 45, world.days - 1)
    const years = world.days / 365
    let fate: Fate = { kind: 'healthy' }
    const u = rand()
    if (u < world.annualBustOut[age] * years) fate = { kind: 'bust_out', day: failDay(), gamesProof: bernoulli(rand, world.bustOutGamesProofShare) && category === 'physical' }
    else if (u < (world.annualBustOut[age] + world.annualInsolvency[age]) * years) fate = { kind: 'insolvent', day: failDay() }
    specs.push({
      id: `acct_${(i + 1).toString().padStart(4, '0')}`,
      category,
      region,
      age,
      ordersPerDay: Math.max(0.5, lognormal(rand, world.meanOrdersPerDay, 1.0)),
      aov: Math.round(lognormal(rand, world.aovByCategory[category], 0.4)),
      authRate: uniform(rand, world.authRateByRegion[region]),
      proofRate: uniform(rand, world.proofRateByCategory[category]),
      refundRate: uniform(rand, [0.01, 0.05]),
      radarRate: 0.01,
      fate,
    })
  }
  return specs
}

export interface SimOrder extends OrderState {
  /** Ground truth the engine never sees directly. */
  truth: {
    unfulfilled: boolean
    dispute?: { type: DisputeType; day: Day; loss: Cents }
    /** Day verified fulfillment proof (carrier delivery or Billing usage) arrived, if ever. */
    verifiedFulfillmentDay: Day | null
  }
}

/**
 * Generate one merchant's payments with proofs and true disputes. Deterministic per merchant
 * and seed. Dispute events are attached as adverse events on the day they arrive.
 */
export function generateOrders(spec: MerchantSpec, world: WorldAssumptions, merchantIndex: number): SimOrder[] {
  const rand = mulberry32(world.seed * 31 + merchantIndex * 7919)
  const orders: SimOrder[] = []
  const end = spec.fate.kind === 'healthy' ? world.days : spec.fate.day
  const failDay = spec.fate.kind === 'healthy' ? Infinity : spec.fate.day
  const bust = spec.fate.kind === 'bust_out' ? spec.fate : null
  let verifiedSoFar = 0
  let seq = 0

  for (let d = 0; d < end; d++) {
    let rate = spec.ordersPerDay
    const inRamp = bust !== null && d >= failDay - world.bustOutRampDays
    if (inRamp) rate *= 1 + ((world.bustOutRampMultiple - 1) * (d - (failDay - world.bustOutRampDays))) / world.bustOutRampDays
    const n = poisson(rand, rate)

    for (let j = 0; j < n; j++) {
      const id = `${spec.id}_py${(++seq).toString(36)}`
      const amount = Math.max(5_00, Math.round(lognormal(rand, spec.aov, 0.8)))
      const seasoning =
        spec.age === 'new' ? Math.min(1, world.seasoningStart + ((1 - world.seasoningStart) * verifiedSoFar) / world.seasoningOrders) : 1
      const authenticated = bernoulli(rand, inRamp ? spec.authRate * 0.4 : spec.authRate)
      const insolvencyZone = spec.fate.kind === 'insolvent' && d >= failDay - world.insolvencyUnfulfilledDays
      const unfulfilled =
        (insolvencyZone && bernoulli(rand, world.insolvencyUnfulfilledShare)) || (inRamp && bernoulli(rand, world.bustOutUnfulfilledShare))
      const gamed = unfulfilled && inRamp && bust!.gamesProof

      const proofs: ProofEvent[] = []
      if (authenticated) proofs.push({ id: `${id}_auth`, paymentId: id, kind: 'authentication', source: 'stripe_3ds', day: d })

      let verifiedDay: Day | null = null
      let trulyReceived = !unfulfilled
      if (spec.category === 'physical') {
        if (gamed) {
          // Empty parcel with real tracking: the carrier confirms delivery of nothing.
          verifiedDay = d + randInt(rand, 2, 5)
          proofs.push({ id: `${id}_dlv`, paymentId: id, kind: 'delivery', source: 'carrier', day: verifiedDay })
          trulyReceived = false
        } else if (!unfulfilled) {
          const lost = bernoulli(rand, 0.015)
          trulyReceived = !lost
          const deliveredDay = d + 2 + poisson(rand, 2.5)
          if (bernoulli(rand, spec.proofRate) && !lost) {
            if (bernoulli(rand, world.carrierVerifiableShare)) {
              verifiedDay = deliveredDay
              proofs.push({ id: `${id}_dlv`, paymentId: id, kind: 'delivery', source: 'carrier', day: deliveredDay })
            } else {
              proofs.push({ id: `${id}_dlv`, paymentId: id, kind: 'delivery', source: 'merchant_api', day: deliveredDay })
            }
          }
        }
      } else if (!unfulfilled && bernoulli(rand, spec.proofRate)) {
        const usedDay = d + randInt(rand, 0, 7)
        const source = spec.category === 'service' && bernoulli(rand, 0.5) ? 'merchant_api' : 'billing_meter'
        if (source === 'billing_meter') verifiedDay = usedDay
        proofs.push({ id: `${id}_use`, paymentId: id, kind: 'usage', source, day: usedDay })
      }
      if (verifiedDay !== null) verifiedSoFar++

      const refunded = !unfulfilled && bernoulli(rand, spec.refundRate)
      if (refunded) proofs.push({ id: `${id}_rf`, paymentId: id, kind: 'refund', source: 'stripe_refunds', day: d + randInt(rand, 2, 25), amount })

      // True dispute process.
      const used = spec.category !== 'physical' && verifiedDay !== null
      const base = world.baseDisputeRate
      const rr = world.relativeRisk
      const p: Record<DisputeType, number> = {
        fraud: base.fraud * (authenticated ? rr.authenticatedFraud : 1) * (inRamp ? 8 : 1),
        not_received: unfulfilled && !gamed
          ? world.unfulfilledDisputeRate
          : spec.category === 'physical'
            ? trulyReceived ? base.not_received * rr.deliveredNotReceived : gamed ? base.not_received : 0.3
            : base.not_received * (used ? rr.usedNotReceived : 1),
        not_as_described: gamed ? 0.35 : base.not_as_described * (used ? rr.usedNotAsDescribed : 1),
        credit_not_processed: refunded ? 0 : base.credit_not_processed,
      }
      let dispute: SimOrder['truth']['dispute']
      let u = rand()
      for (const type of ['fraud', 'not_received', 'not_as_described', 'credit_not_processed'] as const) {
        if (u < p[type]) {
          const delay = weibull(rand, world.disputeDelay[type].shape, world.disputeDelay[type].scaleDays)
          const minDelay = type === 'not_received' ? 7 : 1
          const day = d + Math.min(MAX_DISPUTE_DELAY, Math.max(minDelay, Math.round(delay)))
          const lgd = world.lossGivenDispute
          const hasDeliveryProof = verifiedDay !== null && verifiedDay <= day
          const lossShare =
            type === 'fraud'
              ? authenticated ? lgd.fraudAuthenticated : lgd.fraudUnauthenticated
              : type === 'not_received'
                ? hasDeliveryProof && !gamed ? lgd.notReceivedWithProof : lgd.notReceivedNoProof
                : type === 'not_as_described'
                  ? gamed ? 0.8 : lgd.notAsDescribed
                  : lgd.credit
          dispute = { type, day, loss: bernoulli(rand, lossShare) ? amount : 0 }
          break
        }
        u -= p[type]
      }

      orders.push({
        payment: {
          id,
          merchantId: spec.id,
          amount,
          capturedDay: d,
          fulfillment: spec.category,
          seasoning,
          radarFlag: bernoulli(rand, spec.radarRate) ? 'elevated_risk' : undefined,
        },
        proofs,
        adverse: dispute ? [{ kind: 'dispute', paymentId: id, day: dispute.day, disputeType: dispute.type, amount }] : [],
        truth: { unfulfilled, dispute, verifiedFulfillmentDay: verifiedDay },
      })
    }
  }
  return orders
}

export function describeFate(fate: Fate): string {
  switch (fate.kind) {
    case 'healthy':
      return 'Healthy'
    case 'insolvent':
      return `Insolvent on day ${fate.day}`
    case 'bust_out':
      return `Bust-out on day ${fate.day}${fate.gamesProof ? ' (fakes delivery proof)' : ''}`
  }
}


/** Named worlds for the backtest UI: the base case plus two stress tests. */
export const SCENARIOS: Record<'base' | 'stress' | 'adversarial', { label: string; description: string; world: Partial<WorldAssumptions> }> = {
  base: {
    label: 'Base case',
    description: 'Placeholder failure rates: 2 to 5% of merchants become insolvent in a year, under 3% bust out.',
    world: {},
  },
  stress: {
    label: 'Stress: 3x failures',
    description: 'Triple the insolvency and bust-out rates, as in a downturn.',
    world: {
      annualInsolvency: { new: 0.15, established: 0.06 },
      annualBustOut: { new: 0.075, established: 0.009 },
    },
  },
  adversarial: {
    label: 'Adversarial: fake proof',
    description: 'Many more bust-outs, and every physical-goods bust-out ships empty parcels with real tracking to game delivery proof.',
    world: {
      annualBustOut: { new: 0.12, established: 0.02 },
      bustOutGamesProofShare: 1,
      categoryMix: { physical: 0.7, digital: 0.1, subscription: 0.15, service: 0.05 },
    },
  },
}
