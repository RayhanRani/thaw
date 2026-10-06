import { useEffect, useMemo, useRef, useState } from 'react'
import type { BacktestResult, FloorMode, PolicyResult } from '../../engine/backtest'
import { SCENARIOS } from '../../engine/simulate'
import { LineChart } from '../charts/LineChart'
import { XYChart } from '../charts/XYChart'
import { bps, compactUsd, num, pct } from '../lib/format'
import { PageHeader } from '../shell/AppShell'
import { Badge, Button, Callout, Card, CardHeader, Segmented, Slider, Toggle } from '../ui'
import type { BacktestRequest, SeedRow } from '../workers/backtest.worker'
import snapshot from '../data/snapshot.json'

type Scenario = keyof typeof SCENARIOS

interface Controls {
  scenario: Scenario
  modelId: 'pilot' | 'toy'
  floorMode: FloorMode
  floorShare: number
  killSwitchSignals: boolean
  seasoning: boolean
  newMerchantsStayFlat: boolean
  seed: number
}

const DEFAULTS: Controls = {
  scenario: 'base',
  modelId: 'pilot',
  floorMode: 'unproven_volume',
  floorShare: 0.3,
  killSwitchSignals: true,
  seasoning: true,
  newMerchantsStayFlat: false,
  seed: 20261004,
}

function useBacktestWorker() {
  const workerRef = useRef<Worker | null>(null)
  const seq = useRef(0)
  // The default settings start from the saved run, so the page is never empty on first load.
  const [result, setResult] = useState<BacktestResult | null>(snapshot.defaultResult as unknown as BacktestResult)
  const [progress, setProgress] = useState<number | null>(null)
  const [seedRows, setSeedRows] = useState<SeedRow[] | null>(null)
  const [seedProgress, setSeedProgress] = useState<number | null>(null)
  const latest = useRef({ run: 0, seeds: 0 })

  useEffect(() => {
    const w = new Worker(new URL('../workers/backtest.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e) => {
      const msg = e.data
      if (msg.type === 'progress') {
        if (msg.id === latest.current.run) setProgress(msg.done / msg.total)
        if (msg.id === latest.current.seeds) setSeedProgress(msg.done / msg.total)
      } else if (msg.type === 'result' && msg.id === latest.current.run) {
        setResult(msg.result)
        setProgress(null)
      } else if (msg.type === 'seeds' && msg.id === latest.current.seeds) {
        setSeedRows(msg.rows)
        setSeedProgress(null)
      }
    }
    workerRef.current = w
    return () => w.terminate()
  }, [])

  const run = (c: Controls) => {
    const id = ++seq.current
    latest.current.run = id
    setProgress(0)
    const req: BacktestRequest = { id, kind: 'run', ...c }
    workerRef.current?.postMessage(req)
  }
  const runSeeds = (c: Controls) => {
    const id = ++seq.current
    latest.current.seeds = id
    setSeedProgress(0)
    setSeedRows(null)
    workerRef.current?.postMessage({ id, kind: 'seeds', ...c } satisfies BacktestRequest)
  }
  return { result, progress, run, seedRows, seedProgress, runSeeds }
}

export function Simulation() {
  const [c, setC] = useState<Controls>(DEFAULTS)
  const { result, progress, run, seedRows, seedProgress, runSeeds } = useBacktestWorker()
  const set = (p: Partial<Controls>) => setC((cur) => ({ ...cur, ...p }))

  // Re-run only when the settings differ from the ones the shown result came from.
  const lastKey = useRef(JSON.stringify(DEFAULTS))
  useEffect(() => {
    const key = JSON.stringify(c)
    if (key === lastKey.current) return
    lastKey.current = key
    const t = setTimeout(() => run(c), 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c])

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Shadow mode"
        title="Test Thaw before any money moves"
        subtitle="Replay a year of payments through today's reserve and through Thaw, side by side. This is a synthetic world of 300 merchants; Stripe would plug in its own history and keep everything else."
        action={
          <Badge tone="warn" dot>
            Synthetic data
          </Badge>
        }
      />
      <Card>
        <div className="grid gap-x-6 gap-y-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-1.5">
            <div className="text-[13px] text-ink-2">World</div>
            <Segmented<Scenario>
              label="Scenario"
              value={c.scenario}
              onChange={(scenario) => set({ scenario })}
              options={[
                { value: 'base', label: 'Base' },
                { value: 'stress', label: '3x failures' },
                { value: 'adversarial', label: 'Fake proof' },
              ]}
            />
            <div className="text-xs text-muted">{SCENARIOS[c.scenario].description}</div>
          </div>
          <div className="space-y-1.5">
            <div className="text-[13px] text-ink-2">Risk model</div>
            <Segmented
              label="Model"
              value={c.modelId}
              onChange={(modelId) => set({ modelId })}
              options={[
                { value: 'pilot', label: 'Pilot' },
                { value: 'toy', label: 'PRD toy' },
              ]}
            />
            <label className="mt-1 flex items-center gap-2 text-[13px] text-ink-2">
              Seed
              <input
                type="number"
                className="w-28 rounded-md border border-line bg-surface px-2 py-1 text-ink"
                value={c.seed}
                onChange={(e) => set({ seed: Number(e.target.value) || 1 })}
              />
            </label>
          </div>
          <div className="space-y-2">
            <div className="text-[13px] text-ink-2">Account floor</div>
            <Segmented<FloorMode>
              label="Floor"
              value={c.floorMode}
              onChange={(floorMode) => set({ floorMode, floorShare: floorMode === 'trailing_volume' ? 0.06 : 0.3 })}
              options={[
                { value: 'unproven_volume', label: 'Unproven' },
                { value: 'trailing_volume', label: 'All sales' },
                { value: 'none', label: 'None' },
              ]}
            />
            {c.floorMode !== 'none' && (
              <Slider
                label={c.floorMode === 'unproven_volume' ? 'Share of last 30 days without verified delivery' : 'Share of last 30 days of volume'}
                value={c.floorShare}
                min={0}
                max={c.floorMode === 'unproven_volume' ? 1 : 0.2}
                step={c.floorMode === 'unproven_volume' ? 0.05 : 0.01}
                onChange={(floorShare) => set({ floorShare })}
                format={(v) => pct(v)}
              />
            )}
          </div>
          <div className="space-y-2.5">
            <Toggle checked={c.killSwitchSignals} onChange={(killSwitchSignals) => set({ killSwitchSignals })} label="Kill-switch signals" hint="Volume spike, proof-coverage drop, dispute spike" />
            <Toggle checked={c.seasoning} onChange={(seasoning) => set({ seasoning })} label="New-account pacing" hint="Proof earns half its effect on a new account's first orders" />
            <Toggle checked={c.newMerchantsStayFlat} onChange={(newMerchantsStayFlat) => set({ newMerchantsStayFlat })} label="New merchants stay flat" hint="PRD calibration step 2" />
          </div>
        </div>
        <div className="mt-4 flex items-center gap-3 border-t border-line pt-3 text-[13px] text-ink-2">
          {progress !== null ? (
            <>
              <div className="h-1.5 w-40 rounded-full bg-surface-2">
                <div className="h-1.5 rounded-full bg-accent transition-all" style={{ width: `${progress * 100}%` }} />
              </div>
              Replaying payments…
            </>
          ) : result ? (
            <>
              {num(result.orders)} payments, {compactUsd(result.volume / 100)} of volume, {result.failures.insolvent} insolvencies and {result.failures.bustOut} bust-outs
              {result.failures.gamedBustOut > 0 ? ` (${result.failures.gamedBustOut} faking delivery proof)` : ''}. Ran in {(result.elapsedMs / 1000).toFixed(1)}s.
            </>
          ) : null}
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setC(DEFAULTS)}>
            Reset
          </Button>
        </div>
      </Card>

      {result && (
        <div className={progress !== null ? 'pointer-events-none space-y-4 opacity-60 transition-opacity' : 'space-y-4 transition-opacity'}>
          <Verdict r={result} />
          <div className="grid gap-4 lg:grid-cols-5">
            <div className="lg:col-span-3">
              <Frontier r={result} />
            </div>
            <div className="lg:col-span-2">
              <Scorecard r={result} />
            </div>
          </div>
          <details className="group card overflow-hidden">
            <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4 text-[15px] font-semibold">
              More detail: release speed, portfolio, segments, six more worlds
              <span className="text-[13px] font-medium text-accent-ink group-open:hidden">Show</span>
              <span className="hidden text-[13px] font-medium text-accent-ink group-open:inline">Hide</span>
            </summary>
            <div className="space-y-4 border-t border-line bg-page/40 p-4">
              <div className="grid gap-4 lg:grid-cols-2">
                <ReleaseCurve r={result} />
                <HeldOverTime r={result} />
              </div>
              <Cuts r={result} />
              <Robustness rows={seedRows} progress={seedProgress} onRun={() => runSeeds(c)} />
              <Limits />
            </div>
          </details>
        </div>
      )}
    </div>
  )
}


function Verdict({ r }: { r: BacktestResult }) {
  const v = r.verdict
  const pass = v.guardrailPass
  return (
    <section className="card grid gap-px overflow-hidden bg-line md:grid-cols-4">
      <div className="bg-surface p-5">
        <div className="text-[13px] text-ink-2">Guardrail: net loss vs control</div>
        <div className="mt-1 flex items-center gap-2">
          <span className={pass ? 'text-2xl font-semibold text-good-ink' : 'text-2xl font-semibold text-critical'}>{pass ? '✓ Pass' : '✕ Fail'}</span>
        </div>
        <div className="mt-1 text-[13px] text-muted">
          {v.lossDeltaBps >= 0 ? '+' : ''}
          {bps(v.lossDeltaBps)} against a {v.marginBps} bps margin
        </div>
      </div>
      <div className="bg-surface p-5">
        <div className="text-[13px] text-ink-2">North star: dollar-days held</div>
        <div className="mt-1 text-2xl font-semibold">{pct(v.dollarDaysCut)} less</div>
        <div className="mt-1 text-[13px] text-muted">
          {num(r.treatment.dollarDaysPer1k)} vs {num(r.control.dollarDaysPer1k)} per $1,000 of volume
        </div>
      </div>
      <div className="bg-surface p-5">
        <div className="text-[13px] text-ink-2">Median days to release</div>
        <div className="mt-1 text-2xl font-semibold">
          {r.release.medianDaysThaw} <span className="text-base font-normal text-muted">vs {r.release.medianDaysFlat}</span>
        </div>
        <div className="mt-1 text-[13px] text-muted">{pct(r.release.earlyReleaseShareThaw)} of held dollars back before the flat date</div>
      </div>
      <div className="bg-surface p-5">
        <div className="text-[13px] text-ink-2">Kill switch</div>
        <div className="mt-1 text-2xl font-semibold">
          {r.killSwitch.failing} of {r.killSwitch.failingTotal}
        </div>
        <div className="mt-1 text-[13px] text-muted">
          failing merchants caught{r.killSwitch.medianDaysBeforeFailure !== null ? `, median ${r.killSwitch.medianDaysBeforeFailure} days early` : ''}; {r.killSwitch.healthy} healthy flagged
        </div>
      </div>
    </section>
  )
}

function Frontier({ r }: { r: BacktestResult }) {
  const toPts = (ps: PolicyResult[]) => ps.map((p) => ({ x: p.dollarDaysPer1k, y: p.lossBps, label: p.label }))
  return (
    <Card>
      <CardHeader
        title="The trade-off: cash held against loss"
        subtitle="Each point is one policy run on the same payments. Lower-left is better. The flat line varies the reserve rate; the Thaw line varies the account floor."
      />
      <XYChart
        ariaLabel="Frontier of dollar-days held against net loss"
        series={[
          { key: 'flat', label: 'Flat reserve, 2% to 25%', color: 'var(--flat)', points: toPts(r.frontier.flat) },
          { key: 'thaw', label: 'Thaw, floor 0% and up', color: 'var(--s1)', points: toPts(r.frontier.thaw) },
        ]}
        highlights={[
          { x: r.control.dollarDaysPer1k, y: r.control.lossBps, label: 'Today' },
          { x: r.treatment.dollarDaysPer1k, y: r.treatment.lossBps, label: 'Thaw pilot' },
        ]}
        xFormat={(v) => num(v)}
        yFormat={(v) => v.toFixed(1)}
        xLabel="Dollar-days held per $1,000 of volume"
        yLabel="Net loss, bps of volume"
      />
      <p className="mt-2 text-[13px] text-ink-2">
        At the loss the flat reserve accepts today, the cheapest Thaw setting holds{' '}
        {r.verdict.bestAtControlLoss ? (
          <span className="font-medium text-ink">
            {pct(1 - r.verdict.bestAtControlLoss.dollarDaysPer1k / r.control.dollarDaysPer1k)} fewer dollar-days ({r.verdict.bestAtControlLoss.label})
          </span>
        ) : (
          <span className="font-medium text-critical">no setting matches it in this world</span>
        )}
        . Thaw without a floor holds {pct(1 - r.treatmentNoFloor.dollarDaysPer1k / r.control.dollarDaysPer1k)} less but loses {bps(r.treatmentNoFloor.lossBps)} against {bps(r.control.lossBps)}.
      </p>
    </Card>
  )
}

function Scorecard({ r }: { r: BacktestResult }) {
  const rows: { metric: string; role: string; control: string; thaw: string; good?: boolean }[] = [
    { metric: 'Dollar-days held per $1k', role: 'North star', control: num(r.control.dollarDaysPer1k), thaw: num(r.treatment.dollarDaysPer1k), good: r.treatment.dollarDaysPer1k < r.control.dollarDaysPer1k },
    { metric: 'Median days to release', role: 'Primary', control: String(r.release.medianDaysFlat), thaw: String(r.release.medianDaysThaw), good: true },
    { metric: 'Early-release share', role: 'Primary', control: '0%', thaw: pct(r.release.earlyReleaseShareThaw), good: true },
    { metric: 'Net chargeback loss', role: 'Guardrail', control: bps(r.control.lossBps), thaw: bps(r.treatment.lossBps), good: r.verdict.guardrailPass },
    { metric: 'Holdback shortfalls', role: 'Guardrail', control: num(r.control.shortfallEvents), thaw: num(r.treatment.shortfallEvents), good: r.treatment.shortfallEvents <= r.control.shortfallEvents },
    { metric: 'Proof coverage', role: 'Driver', control: pct(r.proofCoverage), thaw: pct(r.proofCoverage) },
  ]
  return (
    <Card>
      <CardHeader title="PRD scorecard" subtitle="Control is the flat reserve; treatment is Thaw with the settings above" />
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-line text-left text-xs text-muted">
            <th className="py-1.5 font-medium">Metric</th>
            <th className="py-1.5 text-right font-medium">Control</th>
            <th className="py-1.5 text-right font-medium">Thaw</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.metric} className="border-b border-line last:border-0">
              <td className="py-2">
                <div>{row.metric}</div>
                <div className="text-xs text-muted">{row.role}</div>
              </td>
              <td className="tabular py-2 text-right text-ink-2">{row.control}</td>
              <td className="tabular py-2 text-right font-semibold">
                {row.thaw}
                {row.good !== undefined && <span className={row.good ? 'ml-1.5 text-good-ink' : 'ml-1.5 text-critical'}>{row.good ? '✓' : '✕'}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {r.treatment.shortfallEvents > r.control.shortfallEvents && (
        <div className="mt-3">
          <Callout tone="warn">
            {r.treatment.shortfallEvents - r.control.shortfallEvents} more disputes went partly uncovered than under the flat reserve. The loss guardrail has a 0.5 bps margin; this count has
            none yet, and a pilot would need to set one.
          </Callout>
        </div>
      )}
      <p className="mt-3 text-xs text-muted">
        Shortfalls count post-failure disputes the held pool could not fully cover. Hold tickets, appeal turnaround and sentiment need a live pilot and are not simulated.
      </p>
    </Card>
  )
}

function ReleaseCurve({ r }: { r: BacktestResult }) {
  const xs = r.release.curve.map((p) => p.age)
  return (
    <Card>
      <CardHeader title="How fast held dollars come back" subtitle="Share of each order's capture-day holdback still held, by days since payment" />
      <LineChart
        ariaLabel="Share of holdback still held by days since payment"
        xs={xs}
        series={[
          { key: 'flat', label: 'Flat reserve', color: 'var(--flat)', values: r.release.curve.map((p) => p.flat) },
          { key: 'thaw', label: 'Thaw', color: 'var(--s1)', values: r.release.curve.map((p) => p.thaw), area: true },
        ]}
        xFormat={(d) => `day ${d}`}
        tooltipTitle={(d) => `Day ${d} after payment`}
        yFormat={(v) => pct(v)}
        yMax={1}
      />
      <p className="mt-2 text-xs text-muted">Order level, before the account floor. Orders raised back by a dispute are left out of the release timing.</p>
    </Card>
  )
}

function HeldOverTime({ r }: { r: BacktestResult }) {
  const xs = r.heldOverTime.map((p) => p.day)
  return (
    <Card>
      <CardHeader title="Portfolio balance held" subtitle="All merchants combined, including the account floor and kill switches" />
      <LineChart
        ariaLabel="Total held balance across the portfolio over the year"
        xs={xs}
        series={[
          { key: 'control', label: 'Flat reserve', color: 'var(--flat)', values: r.heldOverTime.map((p) => p.control / 100) },
          { key: 'treatment', label: 'Thaw', color: 'var(--s1)', values: r.heldOverTime.map((p) => p.treatment / 100), area: true },
        ]}
        xFormat={(d) => `day ${d}`}
        tooltipTitle={(d) => `Day ${d}`}
        yFormat={(v) => compactUsd(v)}
      />
    </Card>
  )
}

function Cuts({ r }: { r: BacktestResult }) {
  return (
    <Card>
      <CardHeader
        title="Pre-registered cuts"
        subtitle="The PRD's rule: a gain that only shows up for merchants who were already low-risk is not a win. Loss by segment is noisy because only a few merchants fail."
      />
      <div className="grid gap-6 md:grid-cols-2">
        {r.cuts.map((cut) => (
          <div key={cut.dimension} className="overflow-x-auto">
            <div className="mb-1.5 text-[13px] font-semibold">{cut.dimension}</div>
            <table className="w-full min-w-[420px] text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="py-1.5 font-medium">Segment</th>
                  <th className="py-1.5 text-right font-medium">Merchants</th>
                  <th className="py-1.5 text-right font-medium">Dollar-days cut</th>
                  <th className="py-1.5 text-right font-medium">Loss, control → Thaw</th>
                </tr>
              </thead>
              <tbody>
                {cut.rows.map((row) => {
                  const cutShare = 1 - row.treatment.dollarDaysPer1k / Math.max(1, row.control.dollarDaysPer1k)
                  const worse = row.treatment.lossBps - row.control.lossBps > 0.5
                  return (
                    <tr key={row.segment} className="border-b border-line last:border-0">
                      <td className="py-1.5">{row.segment}</td>
                      <td className="tabular py-1.5 text-right text-ink-2">{row.merchants}</td>
                      <td className="py-1.5 text-right">
                        <div className="ml-auto flex max-w-[150px] items-center gap-2">
                          <div className="h-1.5 flex-1 rounded-full bg-surface-2">
                            <div className="h-1.5 rounded-full bg-accent" style={{ width: `${Math.max(0, cutShare) * 100}%` }} />
                          </div>
                          <span className="tabular w-10 text-right font-medium">{pct(cutShare)}</span>
                        </div>
                      </td>
                      <td className={worse ? 'tabular py-1.5 text-right text-critical' : 'tabular py-1.5 text-right text-ink-2'}>
                        {row.control.lossBps.toFixed(2)} → {row.treatment.lossBps.toFixed(2)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </Card>
  )
}

function Robustness({ rows, progress, onRun }: { rows: SeedRow[] | null; progress: number | null; onRun: () => void }) {
  const summary = useMemo(() => {
    if (!rows) return null
    const cuts = rows.map((r) => r.cut)
    return { min: Math.min(...cuts), max: Math.max(...cuts), passes: rows.filter((r) => r.pass).length }
  }, [rows])
  return (
    <Card>
      <CardHeader
        title="Is it luck? Six more worlds"
        subtitle="Only a handful of merchants fail in any one world, so loss is noisy. Re-run the same settings on six other random worlds."
        action={
          <Button size="sm" variant="primary" onClick={onRun} disabled={progress !== null}>
            {progress !== null ? `Running ${Math.round(progress * 6)}/6…` : 'Run six seeds'}
          </Button>
        }
      />
      {summary && rows ? (
        <>
          <Callout tone={summary.passes === rows.length ? 'good' : 'warn'}>
            Dollar-days cut between {pct(summary.min)} and {pct(summary.max)}. Guardrail passed in {summary.passes} of {rows.length} worlds.
          </Callout>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="py-1.5 font-medium">Seed</th>
                  <th className="py-1.5 text-right font-medium">Failing merchants</th>
                  <th className="py-1.5 text-right font-medium">Dollar-days cut</th>
                  <th className="py-1.5 text-right font-medium">Loss, control</th>
                  <th className="py-1.5 text-right font-medium">Loss, Thaw</th>
                  <th className="py-1.5 text-right font-medium">Guardrail</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.seed} className="border-b border-line last:border-0">
                    <td className="tabular py-1.5">{row.seed}</td>
                    <td className="tabular py-1.5 text-right text-ink-2">{row.failing}</td>
                    <td className="tabular py-1.5 text-right font-medium">{pct(row.cut)}</td>
                    <td className="tabular py-1.5 text-right text-ink-2">{bps(row.controlLoss)}</td>
                    <td className="tabular py-1.5 text-right text-ink-2">{bps(row.thawLoss)}</td>
                    <td className="py-1.5 text-right">
                      <Badge tone={row.pass ? 'good' : 'critical'} dot>
                        {row.pass ? 'Pass' : 'Fail'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p className="text-[13px] text-ink-2">Takes about ten seconds.</p>
      )}
    </Card>
  )
}

function Limits() {
  return (
    <Card>
      <CardHeader title="What this does not show" />
      <ul className="list-disc space-y-1.5 pl-4 text-[13px] text-ink-2">
        <li>Every rate, curve and failure pattern is a placeholder. The synthetic world assumes evidence lowers dispute risk; real data has to show that it does.</li>
        <li>Network and bank-sponsor minimum reserves, float income and operating cost are outside the simulation.</li>
        <li>
          To run on real data, replace <code className="font-mono text-xs">generateOrders</code> with a loader for payments, proof events, disputes and merchant closure dates. The ledger,
          signals, metrics and cuts stay the same.
        </li>
      </ul>
    </Card>
  )
}
