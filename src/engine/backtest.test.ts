import { describe, expect, it } from 'vitest'
import { poissonTail, runBacktest } from './backtest'

describe('shadow backtest harness', () => {
  const r = runBacktest({ world: { merchants: 80, seed: 11 } })

  it('the flat reserve holds 10% for 90 days: about 9,000 dollar-days per $1,000', () => {
    // Slightly under 9,000 because payments from merchants that fail stop counting at failure.
    expect(r.control.dollarDaysPer1k).toBeGreaterThan(8_500)
    expect(r.control.dollarDaysPer1k).toBeLessThanOrEqual(9_000)
  })

  it('Thaw holds less than the flat reserve, and a floor holds more than no floor', () => {
    expect(r.treatmentNoFloor.dollarDaysPer1k).toBeLessThan(r.treatment.dollarDaysPer1k)
    expect(r.treatment.dollarDaysPer1k).toBeLessThan(r.control.dollarDaysPer1k)
  })

  it('a higher flat rate never loses more', () => {
    const losses = r.frontier.flat.map((p) => p.loss)
    for (let i = 1; i < losses.length; i++) expect(losses[i]).toBeLessThanOrEqual(losses[i - 1] + 1e-6)
  })

  it('reports release timing and a verdict', () => {
    expect(r.release.medianDaysThaw).toBeLessThan(r.release.medianDaysFlat)
    expect(r.release.earlyReleaseShareThaw).toBeGreaterThan(0)
    expect(r.release.earlyReleaseShareThaw).toBeLessThanOrEqual(1)
    expect(typeof r.verdict.guardrailPass).toBe('boolean')
    expect(r.cuts.map((c) => c.dimension)).toEqual(['Merchant age', 'Category', 'Region', 'Proof coverage'])
  })

  it('is deterministic for a seed', () => {
    const again = runBacktest({ world: { merchants: 80, seed: 11 } })
    expect(again.treatment.dollarDaysPer1k).toBe(r.treatment.dollarDaysPer1k)
    expect(again.treatment.loss).toBe(r.treatment.loss)
  })
})

describe('signal statistics', () => {
  it('poisson tail probabilities', () => {
    expect(poissonTail(2, 0)).toBe(1)
    expect(poissonTail(2, 1)).toBeCloseTo(1 - Math.exp(-2), 10)
    expect(poissonTail(1, 10)).toBeLessThan(1e-6)
    expect(poissonTail(1000, 1000)).toBeGreaterThan(0.4)
  })
})
