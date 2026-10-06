/**
 * Economics and sizing (PRD "Economics and sizing"). Dollars here are whole dollars, not
 * cents, because the inputs are network-scale.
 *
 * The PRD's own figures are reproduced exactly in economics.test.ts:
 * - each 0.1% of $1.9T held for 120 days is about $625M of trapped cash
 * - advance revenue V * h * a * f with V $1.9T, h 0.5%, a 50%, f 2% is $95M a year
 */

export interface SizingRow {
  heldShare: number
  volumeHeldPerYear: number
  averageBalanceHeld: number
}

export function sizingTable(annualVolume: number, heldShares: number[], holdDays: number): SizingRow[] {
  return heldShares.map((h) => ({
    heldShare: h,
    volumeHeldPerYear: annualVolume * h,
    averageBalanceHeld: (annualVolume * h * holdDays) / 365,
  }))
}

/** PRD formula: Advance revenue = V * h * a * f. */
export function advanceRevenue(V: number, h: number, a: number, f: number): number {
  return V * h * a * f
}

export interface EconomicsInputs {
  /** V: annual payment volume in dollars. */
  annualVolume: number
  /** h: share of volume that is held. */
  heldShare: number
  /** Average days a held dollar stays held under today's reserves. */
  holdDays: number
  /** Share of dollar-days Thaw removes (from the backtest; the PRD toy model says 0.78). */
  dollarDaysCut: number
  /** a: share of held dollars advanced. */
  advanceShare: number
  /** f: fee on advanced dollars. */
  advanceFee: number
  /** Average days an advance is outstanding. */
  advanceDays: number
  costOfFundsAnnual: number
  /** Advance defaults as a share of advanced dollars. */
  advanceLossRate: number
  /**
   * Yield Stripe earns on held balances, if any. Unknown from public sources; the PRD says to
   * confirm with Finance before pitching. 0 means "assume none".
   */
  floatYield: number
  /** Hypothesis, not counted by default: share of held merchants who stay because of Thaw. */
  retainedShareOfHeldVolume: number
  /** Net revenue Stripe keeps per dollar of retained volume. */
  netTakeRate: number
  includeHypotheses: boolean
}

export const PRD_ECONOMICS: EconomicsInputs = {
  annualVolume: 1.9e12,
  heldShare: 0.005,
  holdDays: 120,
  dollarDaysCut: 0.78,
  advanceShare: 0.5,
  advanceFee: 0.02,
  advanceDays: 45,
  costOfFundsAnnual: 0.05,
  advanceLossRate: 0.003,
  floatYield: 0,
  retainedShareOfHeldVolume: 0.02,
  netTakeRate: 0.006,
  includeHypotheses: false,
}

export interface EconomicsResult {
  volumeHeldPerYear: number
  averageBalanceHeld: number
  /** Average balance merchants get back under Thaw. */
  cashReturnedToMerchants: number
  advancedPerYear: number
  advanceFees: number
  advanceCostOfFunds: number
  advanceLosses: number
  lostFloat: number
  retentionUpside: number
  net: number
}

export function economics(x: EconomicsInputs): EconomicsResult {
  const volumeHeldPerYear = x.annualVolume * x.heldShare
  const averageBalanceHeld = (volumeHeldPerYear * x.holdDays) / 365
  const cashReturnedToMerchants = averageBalanceHeld * x.dollarDaysCut
  const advancedPerYear = volumeHeldPerYear * x.advanceShare
  const advanceFees = advanceRevenue(x.annualVolume, x.heldShare, x.advanceShare, x.advanceFee)
  const advanceCostOfFunds = (advancedPerYear * x.costOfFundsAnnual * x.advanceDays) / 365
  const advanceLosses = advancedPerYear * x.advanceLossRate
  const lostFloat = cashReturnedToMerchants * x.floatYield
  const retentionUpside = x.retainedShareOfHeldVolume * heldMerchantVolume(x) * x.netTakeRate
  const net = advanceFees - advanceCostOfFunds - advanceLosses - lostFloat + (x.includeHypotheses ? retentionUpside : 0)
  return {
    volumeHeldPerYear,
    averageBalanceHeld,
    cashReturnedToMerchants,
    advancedPerYear,
    advanceFees,
    advanceCostOfFunds,
    advanceLosses,
    lostFloat,
    retentionUpside,
    net,
  }
}

/**
 * Total annual volume of merchants who are under a hold. A reserve holds a share of a held
 * merchant's volume; assuming a 10% reserve, held merchants process 10x the held volume.
 */
function heldMerchantVolume(x: EconomicsInputs, reserveRate = 0.1): number {
  return (x.annualVolume * x.heldShare) / reserveRate
}
