/// <reference lib="webworker" />
import { runBacktest, type FloorMode } from '../../engine/backtest'
import { PRD_TOY_MODEL, THAW_PILOT_MODEL } from '../../engine/model'
import { SCENARIOS } from '../../engine/simulate'

export interface BacktestRequest {
  id: number
  kind: 'run' | 'seeds'
  scenario: keyof typeof SCENARIOS
  modelId: 'pilot' | 'toy'
  floorMode: FloorMode
  floorShare: number
  killSwitchSignals: boolean
  seasoning: boolean
  newMerchantsStayFlat: boolean
  seed: number
  seeds?: number[]
}

export interface SeedRow {
  seed: number
  failing: number
  controlDd: number
  thawDd: number
  cut: number
  controlLoss: number
  thawLoss: number
  lossDelta: number
  pass: boolean
}

function options(req: BacktestRequest, seed: number) {
  return {
    world: { ...SCENARIOS[req.scenario].world, seed },
    treatment: {
      model: req.modelId === 'toy' ? PRD_TOY_MODEL : THAW_PILOT_MODEL,
      floorMode: req.floorMode,
      floorShare: req.floorShare,
      killSwitchSignals: req.killSwitchSignals,
      seasoning: req.seasoning,
      newMerchantsStayFlat: req.newMerchantsStayFlat,
    },
  }
}

self.onmessage = (e: MessageEvent<BacktestRequest>) => {
  const req = e.data
  if (req.kind === 'run') {
    const result = runBacktest({
      ...options(req, req.seed),
      onProgress: (done, total) => {
        if (done % 20 === 0) self.postMessage({ id: req.id, type: 'progress', done, total })
      },
    })
    self.postMessage({ id: req.id, type: 'result', result })
    return
  }
  const rows: SeedRow[] = []
  const seeds = req.seeds ?? [1, 2, 3, 4, 5, 6]
  seeds.forEach((seed, i) => {
    const r = runBacktest(options(req, seed))
    rows.push({
      seed,
      failing: r.failures.insolvent + r.failures.bustOut,
      controlDd: r.control.dollarDaysPer1k,
      thawDd: r.treatment.dollarDaysPer1k,
      cut: r.verdict.dollarDaysCut,
      controlLoss: r.control.lossBps,
      thawLoss: r.treatment.lossBps,
      lossDelta: r.verdict.lossDeltaBps,
      pass: r.verdict.guardrailPass,
    })
    self.postMessage({ id: req.id, type: 'progress', done: i + 1, total: seeds.length })
  })
  self.postMessage({ id: req.id, type: 'seeds', rows })
}
