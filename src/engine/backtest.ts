/**
 * Shadow-mode backtest (PRD 1.4 and "Experiment design"): replay payments through the flat
 * reserve (control) and Thaw (treatment) on identical event streams, with no money moving,
 * and compare the PRD's north star (dollar-days held per $1,000 of volume) against its
 * guardrail (net chargeback loss in basis points of volume).
 *
 * Loss accounting. A live merchant pays its own disputes. Stripe loses money only on disputes
 * that arrive after a merchant stops operating, beyond what is held at that moment. So:
 *   pool at failure = held balance on the last operating day (frozen from then on)
 *   loss            = Σ post-failure dispute losses not covered by the pool
 */

import { curveTables, unitHoldbackPath } from './fastpath'
import type { RiskModel } from './model'
import { THAW_PILOT_MODEL } from './model'
import { DEFAULT_WORLD, generateMerchants, generateOrders, type MerchantSpec, type SimOrder, type WorldAssumptions } from './simulate'
import type { Day, ReservePolicy } from './types'

export type FloorMode = 'none' | 'trailing_volume' | 'unproven_volume'

export interface TreatmentConfig {
  model: RiskModel
  /** Reserve rate at capture, the same for control and treatment. */
  rate: number
  windowDays: number
  /**
   * Account floor (PRD 1.3).
   * - trailing_volume: a share of the last 30 days of volume
   * - unproven_volume: a share of the last 30 days of payments that still lack verified fulfillment proof
   */
  floorMode: FloorMode
  floorShare: number
  /** Merchant-level signals that flip the kill switch: proof coverage drop, dispute spike, volume spike. */
  killSwitchSignals: boolean
  /** New merchants' first orders release slowly. */
  seasoning: boolean
  /**
   * PRD calibration step 2: "new merchants and thin-data categories keep the flat schedule until
   * enough data exists". When on, merchants new to the platform stay on the flat reserve for the
   * whole backtest; Thaw applies only to established merchants.
   */
  newMerchantsStayFlat: boolean
}

export const DEFAULT_TREATMENT: TreatmentConfig = {
  model: THAW_PILOT_MODEL,
  rate: 0.1,
  windowDays: 90,
  floorMode: 'unproven_volume',
  floorShare: 0.3,
  killSwitchSignals: true,
  seasoning: true,
  newMerchantsStayFlat: false,
}

export interface PolicyResult {
  label: string
  kind: 'flat' | 'thaw'
  rate: number
  floorMode: FloorMode
  floorShare: number
  volume: number
  /** North star: dollar-days held per $1,000 of volume. */
  dollarDaysPer1k: number
  /** Guardrail: unrecovered dispute loss in basis points of volume. */
  lossBps: number
  loss: number
  /** Post-failure disputes the held pool could not fully cover. */
  shortfallEvents: number
}

export interface SegmentRow {
  segment: string
  merchants: number
  volume: number
  control: { dollarDaysPer1k: number; lossBps: number }
  treatment: { dollarDaysPer1k: number; lossBps: number }
}

export interface BacktestResult {
  world: WorldAssumptions
  treatmentConfig: Omit<TreatmentConfig, 'model'> & { modelName: string; modelVersion: string }
  merchants: number
  orders: number
  volume: number
  proofCoverage: number
  disputes: { count: number; lostAmount: number }
  failures: { insolvent: number; bustOut: number; gamedBustOut: number }
  killSwitch: {
    /** Failing merchants the signals caught before they failed, out of all failing merchants. */
    failing: number
    failingTotal: number
    /** Healthy merchants flipped to the flat schedule (false positives). */
    healthy: number
    medianDaysBeforeFailure: number | null
    bySignal: Record<KillSignal, { failing: number; healthy: number }>
  }
  control: PolicyResult
  treatment: PolicyResult
  /** Treatment without any floor, to show what the floor buys. */
  treatmentNoFloor: PolicyResult
  frontier: { flat: PolicyResult[]; thaw: PolicyResult[] }
  release: {
    medianDaysThaw: number
    medianDaysFlat: number
    earlyReleaseShareThaw: number
    /** Share of the capture-day holdback still held, by age in days. */
    curve: { age: number; thaw: number; flat: number }[]
  }
  heldOverTime: { day: Day; control: number; treatment: number }[]
  cuts: { dimension: string; rows: SegmentRow[] }[]
  verdict: {
    dollarDaysCut: number
    lossDeltaBps: number
    marginBps: number
    guardrailPass: boolean
    /** The cheapest Thaw frontier point with loss no worse than control. */
    bestAtControlLoss: PolicyResult | null
  }
  elapsedMs: number
}

interface Ledger {
  spec: MerchantSpec
  failDay: number | null
  killDay: number | null
  killSignal: KillSignal | null
  vol: Float64Array
  unitThaw: Float64Array
  unitFlat: Float64Array
  unproven: Float64Array
  postFailDisputes: { day: Day; loss: number }[]
  volume: number
  coverageShare: number
}

const DAY_SIGNAL_START = 30
/** The unproven-volume floor counts payments from the last 30 days that still lack verified fulfillment proof. */
export const UNPROVEN_LOOKBACK_DAYS = 30

export type KillSignal = 'volume_spike' | 'proof_coverage_drop' | 'dispute_spike'

/** P(X >= k) for X ~ Poisson(mu). */
export function poissonTail(mu: number, k: number): number {
  if (k <= 0) return 1
  if (mu > 500) {
    const z = (k - 0.5 - mu) / Math.sqrt(mu)
    return 0.5 * erfc(z / Math.SQRT2)
  }
  let term = Math.exp(-mu)
  let cdf = 0
  for (let i = 0; i < k; i++) {
    cdf += term
    term *= mu / (i + 1)
  }
  return Math.max(0, 1 - cdf)
}

function erfc(x: number): number {
  // Abramowitz and Stegun 7.1.26
  const t = 1 / (1 + 0.3275911 * Math.abs(x))
  const y = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * Math.exp(-x * x)
  return x >= 0 ? y : 2 - y
}

/**
 * Merchant-level kill-switch signals, computed only from what Stripe would have observed by
 * each day. Each is a significance test against the merchant's own history, so a healthy
 * merchant with noisy volume rarely trips one:
 * - volume spike: last 7 days of payments vs the prior 60 (Poisson tail < 1e-6)
 * - proof coverage drop: payments aged 10-16 days lacking verified fulfillment within 10 days,
 *   vs the same share over the prior 60 days (two-proportion z >= 4.5 and +30 points)
 * - dispute spike: disputes in the last 14 days vs the prior 90 (Poisson tail < 1e-5)
 */
export function detectKillSwitch(orders: SimOrder[], spec: MerchantSpec, days: number): { day: Day; signal: KillSignal } | null {
  if (orders.length === 0) return null
  const end = spec.fate.kind === 'healthy' ? days : spec.fate.day
  const n = end + 1
  const count = new Float64Array(n)
  const provenBy10 = new Float64Array(n)
  const disputes = new Float64Array(n)
  for (const o of orders) {
    const c = o.payment.capturedDay
    count[c]++
    const v = o.truth.verifiedFulfillmentDay
    if (v !== null && v <= c + 10) provenBy10[c]++
    const dd = o.truth.dispute?.day
    if (dd !== undefined && dd < n) disputes[dd]++
  }
  const prefix = (arr: Float64Array) => {
    const p = new Float64Array(arr.length + 1)
    for (let i = 0; i < arr.length; i++) p[i + 1] = p[i] + arr[i]
    return p
  }
  const pc = prefix(count)
  const pp = prefix(provenBy10)
  const pd = prefix(disputes)
  // Sum over days [a, b] inclusive.
  const sum = (p: Float64Array, a: number, b: number) => (b < a ? 0 : p[Math.min(b, n - 1) + 1] - p[Math.max(0, a)])

  for (let d = DAY_SIGNAL_START; d < end; d++) {
    // Volume spike.
    const r7 = sum(pc, d - 6, d)
    const vStart = Math.max(0, d - 66)
    const vLen = d - 6 - vStart
    if (vLen >= 21 && r7 >= 20) {
      const mu = ((sum(pc, vStart, d - 7) + 1) / vLen) * 7
      if (r7 >= 2 * mu && poissonTail(mu, r7) < 1e-6) return { day: d, signal: 'volume_spike' }
    }

    // Proof coverage drop.
    if (d >= 30) {
      const nR = sum(pc, d - 16, d - 10)
      const bStart = Math.max(0, d - 76)
      const nB = sum(pc, bStart, d - 17)
      if (nR >= 15 && nB >= 40) {
        const pR = 1 - sum(pp, d - 16, d - 10) / nR
        const pB = 1 - sum(pp, bStart, d - 17) / nB
        const pooled = (pR * nR + pB * nB) / (nR + nB)
        const se = Math.sqrt(Math.max(pooled * (1 - pooled), 1e-9) * (1 / nR + 1 / nB))
        if (pR - pB >= 0.3 && (pR - pB) / se >= 4.5) return { day: d, signal: 'proof_coverage_drop' }
      }
    }

    // Dispute spike.
    const recent = sum(pd, d - 13, d)
    const dStart = Math.max(0, d - 103)
    const dLen = d - 13 - dStart
    if (recent >= 5 && dLen >= 30) {
      const mu = ((sum(pd, dStart, d - 14) + 1) / dLen) * 14
      if (poissonTail(mu, recent) < 1e-5) return { day: d, signal: 'dispute_spike' }
    }
  }
  return null
}

function buildLedger(spec: MerchantSpec, orders: SimOrder[], world: WorldAssumptions, cfg: TreatmentConfig, tables: ReturnType<typeof curveTables>, releaseHist: Float64Array, releaseBase: { held: number }): Ledger {
  const W = cfg.windowDays
  const L = world.days + W + 1
  const failDay = spec.fate.kind === 'healthy' ? null : spec.fate.day
  const forcedFlat = cfg.newMerchantsStayFlat && spec.age === 'new'
  const kill = cfg.killSwitchSignals && !forcedFlat ? detectKillSwitch(orders, spec, world.days) : null
  const killDay = forcedFlat ? 0 : (kill?.day ?? null)
  const policy: ReservePolicy = {
    rate: cfg.rate,
    windowDays: W,
    floorFixed: 0,
    floorShareOfTrailingVolume: 0,
    floorShareOfUnprovenVolume: 0,
    floorTrailingDays: 30,
    killSwitchDay: killDay ?? undefined,
  }
  const ledger: Ledger = {
    spec,
    failDay,
    killDay,
    killSignal: kill?.signal ?? null,
    vol: new Float64Array(L),
    unitThaw: new Float64Array(L),
    unitFlat: new Float64Array(L),
    unproven: new Float64Array(L),
    postFailDisputes: [],
    volume: 0,
    coverageShare: 0,
  }
  const buf = new Float64Array(W)
  let covered = 0
  for (const o of orders) {
    if (!cfg.seasoning) o.payment.seasoning = 1
    const c = o.payment.capturedDay
    const amount = o.payment.amount
    ledger.vol[c] += amount
    ledger.volume += amount
    if (o.truth.verifiedFulfillmentDay !== null) covered++

    unitHoldbackPath(o, cfg.model, policy, tables, buf)
    const disputeAge = o.truth.dispute ? o.truth.dispute.day - c : Infinity
    const provenAt = o.truth.verifiedFulfillmentDay ?? Infinity
    for (let a = 0; a < W; a++) {
      const d = c + a
      ledger.unitThaw[d] += buf[a]
      ledger.unitFlat[d] += amount
      if (a < UNPROVEN_LOOKBACK_DAYS && d < provenAt) ledger.unproven[d] += amount
    }

    // Order-level release timing (only releases that happen while the merchant operates).
    const opEnd = failDay ?? Infinity
    if (c < opEnd) {
      releaseBase.held += amount
      let prev = amount
      for (let a = 0; a <= W; a++) {
        if (c + a >= opEnd) break
        const cur = a < W ? buf[a] : 0
        if (a === disputeAge && a < W) break // raised back to the flat schedule by a dispute; not counted as an early release
        if (cur < prev) releaseHist[a] += prev - cur
        prev = Math.min(prev, cur)
      }
    }

    const dispute = o.truth.dispute
    if (failDay !== null && dispute && dispute.day >= failDay && dispute.loss > 0) {
      ledger.postFailDisputes.push({ day: dispute.day, loss: dispute.loss })
    }
  }
  ledger.postFailDisputes.sort((a, b) => a.day - b.day)
  ledger.coverageShare = orders.length ? covered / orders.length : 0
  return ledger
}

interface Eval {
  centDays: number
  loss: number
  shortfallEvents: number
}

function evaluateLedger(l: Ledger, kind: 'flat' | 'thaw', rate: number, mode: FloorMode, floorShare: number, series?: Float64Array): Eval {
  const end = l.failDay ?? l.vol.length
  let centDays = 0
  let prev = 0
  let trailing = 0
  for (let d = 0; d < end; d++) {
    trailing += l.vol[d]
    if (d >= 30) trailing -= l.vol[d - 30]
    let held: number
    if (kind === 'flat') {
      held = rate * l.unitFlat[d]
    } else {
      let target = rate * l.unitThaw[d]
      if (mode === 'trailing_volume') target = Math.max(target, floorShare * trailing)
      else if (mode === 'unproven_volume') target = Math.max(target, floorShare * l.unproven[d])
      // Thaw never holds more than the flat reserve would.
      target = Math.min(target, rate * l.unitFlat[d])
      // Increases are funded from today's payouts, so they can't exceed today's volume.
      held = target > prev ? Math.min(target, prev + l.vol[d]) : target
    }
    centDays += held
    if (series) series[d] += held
    prev = held
  }
  let loss = 0
  let shortfallEvents = 0
  if (l.failDay !== null) {
    let pool = prev
    for (const dsp of l.postFailDisputes) {
      const cover = Math.min(pool, dsp.loss)
      pool -= cover
      const uncovered = dsp.loss - cover
      if (uncovered > 0) {
        loss += uncovered
        shortfallEvents++
      }
    }
  }
  return { centDays, loss, shortfallEvents }
}

function evaluate(ledgers: Ledger[], label: string, kind: 'flat' | 'thaw', rate: number, mode: FloorMode, floorShare: number, series?: Float64Array): PolicyResult {
  let centDays = 0
  let loss = 0
  let shortfallEvents = 0
  let volume = 0
  for (const l of ledgers) {
    const e = evaluateLedger(l, kind, rate, mode, floorShare, series)
    centDays += e.centDays
    loss += e.loss
    shortfallEvents += e.shortfallEvents
    volume += l.volume
  }
  return {
    label,
    kind,
    rate,
    floorMode: mode,
    floorShare,
    volume,
    dollarDaysPer1k: volume > 0 ? (centDays / volume) * 1000 : 0,
    lossBps: volume > 0 ? (loss / volume) * 10_000 : 0,
    loss,
    shortfallEvents,
  }
}

function median(sorted: number[]): number | null {
  if (!sorted.length) return null
  const m = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2
}

export interface BacktestOptions {
  world?: Partial<WorldAssumptions>
  treatment?: Partial<TreatmentConfig>
  /** Auto-rollback margin: treatment loss may exceed control by at most this many bps. */
  lossMarginBps?: number
  onProgress?: (done: number, total: number) => void
}

export const FLAT_FRONTIER_RATES = [0.02, 0.04, 0.06, 0.08, 0.1, 0.12, 0.15, 0.2, 0.25]
export const THAW_FRONTIER_FLOORS: Record<Exclude<FloorMode, 'none'>, number[]> = {
  unproven_volume: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.75, 1],
  trailing_volume: [0, 0.02, 0.04, 0.06, 0.08, 0.1, 0.15, 0.2],
}

export function runBacktest(options: BacktestOptions = {}): BacktestResult {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now()
  const world: WorldAssumptions = { ...DEFAULT_WORLD, ...options.world }
  const cfg: TreatmentConfig = { ...DEFAULT_TREATMENT, ...options.treatment }
  const margin = options.lossMarginBps ?? 0.5
  const W = cfg.windowDays
  const tables = curveTables(cfg.model, W)
  const specs = generateMerchants(world)

  const releaseHist = new Float64Array(W + 1)
  const releaseBase = { held: 0 }
  const ledgers: Ledger[] = []
  let orderCount = 0
  let verifiedAny = 0
  let disputeCount = 0
  let disputeLoss = 0
  const killLead: number[] = []
  let killHealthy = 0
  const bySignal: Record<KillSignal, { failing: number; healthy: number }> = {
    volume_spike: { failing: 0, healthy: 0 },
    proof_coverage_drop: { failing: 0, healthy: 0 },
    dispute_spike: { failing: 0, healthy: 0 },
  }

  specs.forEach((spec, i) => {
    const orders = generateOrders(spec, world, i)
    orderCount += orders.length
    for (const o of orders) {
      if (o.truth.verifiedFulfillmentDay !== null || o.proofs.some((p) => p.kind === 'authentication')) verifiedAny++
      if (o.truth.dispute) {
        disputeCount++
        disputeLoss += o.truth.dispute.loss
      }
    }
    const ledger = buildLedger(spec, orders, world, cfg, tables, releaseHist, releaseBase)
    if (ledger.killDay !== null && ledger.killSignal) {
      if (ledger.failDay !== null) killLead.push(ledger.failDay - ledger.killDay)
      else killHealthy++
      bySignal[ledger.killSignal][ledger.failDay !== null ? 'failing' : 'healthy']++
    }
    ledgers.push(ledger)
    options.onProgress?.(i + 1, specs.length)
  })

  const L = world.days + W + 1
  const controlSeries = new Float64Array(L)
  const treatmentSeries = new Float64Array(L)
  const control = evaluate(ledgers, `Flat ${pct(cfg.rate)} for ${W} days`, 'flat', cfg.rate, 'none', 0, controlSeries)
  const treatment = evaluate(ledgers, 'Thaw', 'thaw', cfg.rate, cfg.floorMode, cfg.floorShare, treatmentSeries)
  const treatmentNoFloor = evaluate(ledgers, 'Thaw, no floor', 'thaw', cfg.rate, 'none', 0)

  const flatFrontier = FLAT_FRONTIER_RATES.map((r) => evaluate(ledgers, `Flat ${pct(r)}`, 'flat', r, 'none', 0))
  const frontierMode: FloorMode = cfg.floorMode === 'none' ? 'unproven_volume' : cfg.floorMode
  const thawFrontier = THAW_FRONTIER_FLOORS[frontierMode].map((f) =>
    evaluate(ledgers, f === 0 ? 'Thaw, no floor' : `Thaw, floor ${pct(f)}`, 'thaw', cfg.rate, f === 0 ? 'none' : frontierMode, f),
  )

  // Release timing.
  let cum = 0
  const curve: { age: number; thaw: number; flat: number }[] = []
  let medianDaysThaw = W
  let early = 0
  for (let a = 0; a <= W; a++) {
    cum += releaseHist[a]
    if (a < W) early += releaseHist[a]
    const stillHeld = releaseBase.held > 0 ? 1 - cum / releaseBase.held : 0
    curve.push({ age: a, thaw: Math.max(0, stillHeld), flat: a < W ? 1 : 0 })
    if (medianDaysThaw === W && cum >= releaseBase.held / 2) medianDaysThaw = a
  }
  const totalReleased = releaseHist.reduce((s, x) => s + x, 0)

  // Pre-registered cuts.
  const segmentOf: Record<string, (l: Ledger) => string> = {
    'Merchant age': (l) => (l.spec.age === 'new' ? 'New' : 'Established'),
    Category: (l) => cap(l.spec.category),
    Region: (l) => l.spec.region,
    'Proof coverage': (l) => (l.coverageShare < 0.5 ? 'Under 50%' : l.coverageShare < 0.8 ? '50 to 80%' : '80% and up'),
  }
  const cuts = Object.entries(segmentOf).map(([dimension, fn]) => {
    const groups = new Map<string, Ledger[]>()
    for (const l of ledgers) {
      const k = fn(l)
      groups.set(k, [...(groups.get(k) ?? []), l])
    }
    const rows: SegmentRow[] = [...groups.entries()]
      .map(([segment, ls]) => {
        const c = evaluate(ls, '', 'flat', cfg.rate, 'none', 0)
        const t = evaluate(ls, '', 'thaw', cfg.rate, cfg.floorMode, cfg.floorShare)
        return {
          segment,
          merchants: ls.length,
          volume: c.volume,
          control: { dollarDaysPer1k: c.dollarDaysPer1k, lossBps: c.lossBps },
          treatment: { dollarDaysPer1k: t.dollarDaysPer1k, lossBps: t.lossBps },
        }
      })
      .sort((a, b) => b.volume - a.volume)
    return { dimension, rows }
  })

  const heldOverTime: { day: Day; control: number; treatment: number }[] = []
  for (let d = 0; d < world.days; d += 7) heldOverTime.push({ day: d, control: controlSeries[d], treatment: treatmentSeries[d] })

  const lossDelta = treatment.lossBps - control.lossBps
  const affordable = thawFrontier.filter((p) => p.lossBps <= control.lossBps + 1e-9).sort((a, b) => a.dollarDaysPer1k - b.dollarDaysPer1k)

  const failures = {
    insolvent: specs.filter((s) => s.fate.kind === 'insolvent').length,
    bustOut: specs.filter((s) => s.fate.kind === 'bust_out').length,
    gamedBustOut: specs.filter((s) => s.fate.kind === 'bust_out' && s.fate.gamesProof).length,
  }

  return {
    world,
    treatmentConfig: { ...cfg, model: undefined, modelName: cfg.model.name, modelVersion: cfg.model.version } as BacktestResult['treatmentConfig'],
    merchants: specs.length,
    orders: orderCount,
    volume: control.volume,
    proofCoverage: orderCount ? verifiedAny / orderCount : 0,
    disputes: { count: disputeCount, lostAmount: disputeLoss },
    failures,
    killSwitch: {
      failing: killLead.length,
      failingTotal: failures.insolvent + failures.bustOut,
      healthy: killHealthy,
      medianDaysBeforeFailure: median(killLead.sort((a, b) => a - b)),
      bySignal,
    },
    control,
    treatment,
    treatmentNoFloor,
    frontier: { flat: flatFrontier, thaw: thawFrontier },
    release: {
      medianDaysThaw,
      medianDaysFlat: W,
      earlyReleaseShareThaw: totalReleased > 0 ? early / releaseBase.held : 0,
      curve,
    },
    heldOverTime,
    cuts,
    verdict: {
      dollarDaysCut: control.dollarDaysPer1k > 0 ? 1 - treatment.dollarDaysPer1k / control.dollarDaysPer1k : 0,
      lossDeltaBps: lossDelta,
      marginBps: margin,
      guardrailPass: lossDelta <= margin,
      bestAtControlLoss: affordable[0] ?? null,
    },
    elapsedMs: (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0,
  }
}

function pct(x: number): string {
  return `${Math.round(x * 1000) / 10}%`
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
