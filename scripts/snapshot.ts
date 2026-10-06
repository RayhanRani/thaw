/**
 * Regenerate the headline numbers the Overview page and README quote:  npm run snapshot
 * Runs the default treatment on the base world over six seeds, and on the two stress worlds.
 */
import { writeFileSync } from 'node:fs'
import { runBacktest } from '../src/engine/backtest'
import { SCENARIOS } from '../src/engine/simulate'

const seeds = [1, 2, 3, 4, 5, 6]
const summarize = (scenario: keyof typeof SCENARIOS, newMerchantsStayFlat = false) =>
  seeds.map((seed) => {
    const r = runBacktest({ world: { ...SCENARIOS[scenario].world, seed }, treatment: { newMerchantsStayFlat } })
    return {
      seed,
      cut: r.verdict.dollarDaysCut,
      cutNoFloor: 1 - r.treatmentNoFloor.dollarDaysPer1k / r.control.dollarDaysPer1k,
      controlLossBps: r.control.lossBps,
      thawLossBps: r.treatment.lossBps,
      noFloorLossBps: r.treatmentNoFloor.lossBps,
      lossDeltaBps: r.verdict.lossDeltaBps,
      pass: r.verdict.guardrailPass,
      medianDaysThaw: r.release.medianDaysThaw,
      earlyReleaseShare: r.release.earlyReleaseShareThaw,
      killCaught: r.killSwitch.failing,
      killFailingTotal: r.killSwitch.failingTotal,
      killHealthy: r.killSwitch.healthy,
      merchants: r.merchants,
    }
  })

// Figure data for the Research tab: the default world, run once with the pilot settings.
const fig = runBacktest()
const point = (p: (typeof fig.frontier.flat)[number]) => ({ label: p.label, x: Math.round(p.dollarDaysPer1k), y: Math.round(p.lossBps * 1000) / 1000 })
const figures = {
  seed: fig.world.seed,
  merchants: fig.merchants,
  orders: fig.orders,
  frontier: { flat: fig.frontier.flat.map(point), thaw: fig.frontier.thaw.map(point) },
  control: point(fig.control),
  pilot: point(fig.treatment),
  noFloor: point(fig.treatmentNoFloor),
  releaseCurve: fig.release.curve.map((c) => ({ age: c.age, thaw: Math.round(c.thaw * 1000) / 1000, flat: c.flat })),
  medianDaysThaw: fig.release.medianDaysThaw,
  earlyReleaseShare: fig.release.earlyReleaseShareThaw,
}

const snapshot = {
  generatedAt: new Date().toISOString().slice(0, 10),
  figures,
  /** Full result for the default settings, so Shadow mode renders instantly before any re-run. */
  defaultResult: { ...fig, elapsedMs: Math.round(fig.elapsedMs) },
  base: summarize('base'),
  stress: summarize('stress'),
  adversarial: summarize('adversarial'),
  adversarialNewFlat: summarize('adversarial', true),
}
writeFileSync(new URL('../src/app/data/snapshot.json', import.meta.url), JSON.stringify(snapshot, null, 2) + '\n')
const range = (xs: number[]) => `${Math.min(...xs).toFixed(3)} to ${Math.max(...xs).toFixed(3)}`
for (const k of ['base', 'stress', 'adversarial', 'adversarialNewFlat'] as const) {
  const rows = snapshot[k]
  console.log(`${k.padEnd(12)} cut ${range(rows.map((r) => r.cut))}   loss delta ${range(rows.map((r) => r.lossDeltaBps))} bps   pass ${rows.filter((r) => r.pass).length}/${rows.length}`)
}
