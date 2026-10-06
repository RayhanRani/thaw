/**
 * Run the shadow backtest from the command line:  npm run backtest [-- --seed 7 --floor 0.3]
 * Prints the PRD scorecard: north star, guardrail, frontier and pre-registered cuts.
 */
import { runBacktest, type FloorMode } from '../src/engine/backtest'
import { PRD_TOY_MODEL, THAW_PILOT_MODEL } from '../src/engine/model'
import { SCENARIOS } from '../src/engine/simulate'

const args = process.argv.slice(2)
const arg = (name: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}

const result = runBacktest({
  world: {
    ...SCENARIOS[(arg('scenario') as keyof typeof SCENARIOS) ?? 'base'].world,
    seed: Number(arg('seed') ?? 20261004),
    merchants: Number(arg('merchants') ?? 300),
  },
  treatment: {
    model: arg('model') === 'toy' ? PRD_TOY_MODEL : THAW_PILOT_MODEL,
    floorMode: (arg('floor-mode') as FloorMode) ?? 'unproven_volume',
    floorShare: Number(arg('floor') ?? 0.3),
    killSwitchSignals: arg('signals') !== 'off',
    seasoning: arg('seasoning') !== 'off',
    newMerchantsStayFlat: arg('new-flat') === 'on',
  },
})

const $ = (cents: number) => `$${Math.round(cents / 100).toLocaleString('en-US')}`
const n1 = (x: number) => x.toFixed(1)
const n2 = (x: number) => x.toFixed(2)

console.log(`\nShadow backtest — synthetic world, seed ${result.world.seed}  (${Math.round(result.elapsedMs)} ms)`)
console.log(`${result.merchants} merchants, ${result.orders.toLocaleString()} payments, ${$(result.volume)} volume`)
console.log(`Failures: ${result.failures.insolvent} insolvent, ${result.failures.bustOut} bust-outs (${result.failures.gamedBustOut} fake proof)`)
console.log(`Disputes: ${result.disputes.count.toLocaleString()}, lost ${$(result.disputes.lostAmount)}   Proof coverage: ${(result.proofCoverage * 100).toFixed(0)}%`)
console.log(`Kill switch: caught ${result.killSwitch.failing} of ${result.killSwitch.failingTotal} failing merchants (median ${result.killSwitch.medianDaysBeforeFailure ?? "-"} days early), flagged ${result.killSwitch.healthy} healthy merchants`, JSON.stringify(result.killSwitch.bySignal))
console.log('')
const row = (p: typeof result.control) =>
  `${p.label.padEnd(26)} ${n1(p.dollarDaysPer1k).padStart(9)} dollar-days/$1k   ${n2(p.lossBps).padStart(6)} bps loss   ${String(p.shortfallEvents).padStart(4)} shortfalls`
console.log(row(result.control))
console.log(row(result.treatmentNoFloor))
console.log(row(result.treatment))
const v = result.verdict
console.log(`\nDollar-days cut ${(v.dollarDaysCut * 100).toFixed(1)}%, loss delta ${n2(v.lossDeltaBps)} bps (margin ${v.marginBps}) → guardrail ${v.guardrailPass ? 'PASS' : 'FAIL'}`)
console.log(`Median days to release: Thaw ${result.release.medianDaysThaw}, flat ${result.release.medianDaysFlat}. Early-release share ${(result.release.earlyReleaseShareThaw * 100).toFixed(0)}%`)
if (v.bestAtControlLoss) console.log(`Cheapest Thaw point at or below control loss: ${v.bestAtControlLoss.label} (${n1(v.bestAtControlLoss.dollarDaysPer1k)} dollar-days/$1k)`)
console.log('\nFrontier')
for (const p of [...result.frontier.flat, ...result.frontier.thaw]) console.log('  ' + row(p))
for (const cut of result.cuts) {
  console.log(`\n${cut.dimension}`)
  for (const r of cut.rows)
    console.log(
      `  ${r.segment.padEnd(14)} ${String(r.merchants).padStart(4)} merchants   dd/$1k ${n1(r.control.dollarDaysPer1k).padStart(7)} → ${n1(r.treatment.dollarDaysPer1k).padStart(7)}   loss ${n2(r.control.lossBps).padStart(6)} → ${n2(r.treatment.lossBps).padStart(6)} bps`,
    )
}
