/**
 * Thaw Advance (PRD section 4): lend against the thawing balance, price it from the same loss
 * model, show the total cost in dollars, and repay by netting against scheduled releases.
 */

import type { ReleaseDay } from './account'
import type { RiskModel } from './model'
import type { Cents, Day, ReservePolicy } from './types'

export interface AdvanceTerms {
  /** Advance at most this share of the expected releases inside the horizon. */
  maxShareOfExpectedReleases: number
  /** Only releases within this many days count toward the advance. */
  horizonDays: number
  /** Annual cost of funds for the capital provider. */
  costOfFundsAnnual: number
  /**
   * Chance that a shortfall in releases is never recovered from future payouts, for example
   * because the merchant stops processing. Multiplies the model's expected dispute draw.
   */
  unrecoveredShortfallShare: number
  /** Flat margin on advanced dollars. */
  marginRate: number
  minAdvance: Cents
  /** PRD 4.3: pause new advances when the recent dispute rate is this multiple of baseline. */
  disputeSpikeMultiple: number
}

export const DEFAULT_ADVANCE_TERMS: AdvanceTerms = {
  maxShareOfExpectedReleases: 0.8,
  horizonDays: 60,
  costOfFundsAnnual: 0.055,
  unrecoveredShortfallShare: 0.15,
  marginRate: 0.006,
  minAdvance: 250_00,
  disputeSpikeMultiple: 2,
}

export interface DisputeSignal {
  /** Disputes per payment over the last 30 days. */
  recentRate: number
  /** Disputes per payment over the prior 90 days. */
  baselineRate: number
}

export interface RepaymentStep {
  day: Day
  release: Cents
  toRepayment: Cents
  toMerchant: Cents
  owedAfter: Cents
}

export interface AdvanceQuote {
  eligible: boolean
  ineligibleReason?: string
  /** Scheduled releases inside the horizon, before expected dispute draws. */
  scheduledReleases: Cents
  /** Same, net of the model's expected dispute draws. */
  expectedReleases: Cents
  maxAdvance: Cents
  amount: Cents
  fee: Cents
  feeBreakdown: { costOfFunds: Cents; expectedLoss: Cents; margin: Cents }
  totalRepayment: Cents
  /** Fee per $100 advanced. */
  feePer100: number
  /** Day the advance is expected to be fully repaid from releases, if inside the horizon. */
  expectedPaidOffDay: Day | null
  schedule: RepaymentStep[]
}

/**
 * Share of a held dollar the model expects a dispute to draw before it releases. The holdback
 * starts at the policy rate r while expected loss starts at L, and both follow the same
 * evidence and decay factors, so the ratio is L / r.
 */
export function expectedDrawShare(model: RiskModel, policy: ReservePolicy): number {
  return Math.min(1, model.expectedLossRate / policy.rate)
}

export function quoteAdvance(
  releases: ReleaseDay[],
  today: Day,
  requested: Cents | 'max',
  ctx: { model: RiskModel; policy: ReservePolicy; terms?: AdvanceTerms; signal?: DisputeSignal; killSwitch?: boolean },
): AdvanceQuote {
  const terms = ctx.terms ?? DEFAULT_ADVANCE_TERMS
  const draw = expectedDrawShare(ctx.model, ctx.policy)
  const inHorizon = releases.filter((r) => r.day > today && r.day <= today + terms.horizonDays && r.total > 0)
  const scheduled = Math.round(inHorizon.reduce((s, r) => s + r.total, 0))
  const expected = Math.round(scheduled * (1 - draw))
  const maxAdvance = Math.floor((expected * terms.maxShareOfExpectedReleases) / 10_00) * 10_00

  const base = {
    scheduledReleases: scheduled,
    expectedReleases: expected,
    maxAdvance,
  }
  const ineligible = (reason: string): AdvanceQuote => ({
    ...base,
    eligible: false,
    ineligibleReason: reason,
    amount: 0,
    fee: 0,
    feeBreakdown: { costOfFunds: 0, expectedLoss: 0, margin: 0 },
    totalRepayment: 0,
    feePer100: 0,
    expectedPaidOffDay: null,
    schedule: [],
  })

  if (ctx.killSwitch) return ineligible('This account is on the standard reserve schedule while Risk reviews it.')
  if (ctx.signal && ctx.signal.baselineRate > 0 && ctx.signal.recentRate > terms.disputeSpikeMultiple * ctx.signal.baselineRate) {
    return ineligible('New advances are paused because your dispute rate rose sharply in the last 30 days.')
  }
  if (maxAdvance < terms.minAdvance) {
    return ineligible(`Advances start at $${(terms.minAdvance / 100).toFixed(0)}. Not enough is scheduled to release in the next ${terms.horizonDays} days.`)
  }

  const amount = requested === 'max' ? maxAdvance : Math.max(0, Math.min(requested, maxAdvance))

  // Allocate the advance to releases in date order (repayment nets 100% of each release),
  // then charge cost of funds for the days each slice is outstanding.
  let remaining = amount
  let dollarDays = 0
  for (const r of inHorizon) {
    if (remaining <= 0) break
    const take = Math.min(remaining, r.total * (1 - draw))
    dollarDays += take * (r.day - today)
    remaining -= take
  }
  const costOfFunds = Math.round((dollarDays / 365) * terms.costOfFundsAnnual)
  const expectedLoss = Math.round(amount * draw * terms.unrecoveredShortfallShare)
  const margin = Math.round(amount * terms.marginRate)
  const fee = costOfFunds + expectedLoss + margin
  const total = amount + fee

  let owed = total
  let paidOff: Day | null = null
  const schedule: RepaymentStep[] = []
  for (const r of inHorizon) {
    const release = Math.round(r.total)
    const toRepayment = Math.min(owed, release)
    owed -= toRepayment
    schedule.push({ day: r.day, release, toRepayment, toMerchant: release - toRepayment, owedAfter: owed })
    if (owed === 0 && paidOff === null) paidOff = r.day
  }

  return {
    ...base,
    eligible: true,
    amount,
    fee,
    feeBreakdown: { costOfFunds, expectedLoss, margin },
    totalRepayment: total,
    feePer100: amount > 0 ? (fee / amount) * 100 : 0,
    expectedPaidOffDay: paidOff,
    schedule,
  }
}
