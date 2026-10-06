import { useMemo, useState } from 'react'
import { economics, PRD_ECONOMICS, sizingTable, type EconomicsInputs } from '../../engine/economics'
import { LineChart } from '../charts/LineChart'
import snapshot from '../data/snapshot.json'
import { compactUsd, pct } from '../lib/format'
import { PageHeader } from '../shell/AppShell'
import { Button, Callout, Card, CardHeader, Slider, Toggle } from '../ui'

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const BACKTEST_CUT = median(snapshot.base.map((r) => r.cut))
const CONSERVATIVE_CUT = median(snapshot.adversarialNewFlat.map((r) => r.cut))

export function BusinessCase() {
  const [x, setX] = useState<EconomicsInputs>({ ...PRD_ECONOMICS, dollarDaysCut: Math.round(BACKTEST_CUT * 100) / 100 })
  const set = (p: Partial<EconomicsInputs>) => setX((cur) => ({ ...cur, ...p }))
  const r = useMemo(() => economics(x), [x])
  const sizing = useMemo(() => sizingTable(x.annualVolume, [0.001, 0.005, 0.01], x.holdDays), [x.annualVolume, x.holdDays])
  const beforeFloat = r.advanceFees - r.advanceCostOfFunds - r.advanceLosses + (x.includeHypotheses ? r.retentionUpside : 0)
  const breakEvenYield = r.cashReturnedToMerchants > 0 ? beforeFloat / r.cashReturnedToMerchants : 0
  const yields = Array.from({ length: 26 }, (_, i) => i * 0.002)
  const netByYield = yields.map((y) => beforeFloat - r.cashReturnedToMerchants * y)

  const bridge = [
    { label: 'Advance fees (V × h × a × f)', value: r.advanceFees, kind: 'plus' as const },
    { label: 'Cost of funds on advances', value: -r.advanceCostOfFunds, kind: 'minus' as const },
    { label: 'Advance losses', value: -r.advanceLosses, kind: 'minus' as const },
    { label: 'Float income given up', value: -r.lostFloat, kind: 'minus' as const },
    ...(x.includeHypotheses ? [{ label: 'Retained volume (hypothesis)', value: r.retentionUpside, kind: 'plus' as const }] : []),
  ]
  const scale = Math.max(...bridge.map((b) => Math.abs(b.value)), Math.abs(r.net), 1)

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Business case"
        title="What Thaw is worth, and what it costs"
        subtitle="Network-scale arithmetic on stated assumptions. The defaults reproduce the PRD's figures and take the reduction in held cash from the shadow simulation. Three inputs only Stripe has would replace the guesses."
      />
      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        <Card className="space-y-4">
          <CardHeader title="Inputs" />
          <Slider label="Annual payment volume (V)" value={x.annualVolume} min={0.5e12} max={3e12} step={0.1e12} onChange={(v) => set({ annualVolume: v })} format={compactUsd} hint="Stripe cites about $1.9T" />
          <Slider label="Share of volume held (h)" value={x.heldShare} min={0.001} max={0.01} step={0.0005} onChange={(v) => set({ heldShare: v })} format={(v) => pct(v, 2)} hint="Not published. The PRD's middle case is 0.5%." />
          <Slider label="Average days held today" value={x.holdDays} min={30} max={180} step={5} onChange={(v) => set({ holdDays: v })} format={(v) => `${v} days`} />
          <div>
            <Slider label="Dollar-days Thaw removes" value={x.dollarDaysCut} min={0} max={0.9} step={0.01} onChange={(v) => set({ dollarDaysCut: v })} format={(v) => pct(v)} />
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <Button size="sm" onClick={() => set({ dollarDaysCut: Math.round(BACKTEST_CUT * 100) / 100 })}>
                Backtest {pct(BACKTEST_CUT)}
              </Button>
              <Button size="sm" onClick={() => set({ dollarDaysCut: Math.round(CONSERVATIVE_CUT * 100) / 100 })}>
                Conservative {pct(CONSERVATIVE_CUT)}
              </Button>
              <Button size="sm" onClick={() => set({ dollarDaysCut: 0.78 })}>
                PRD toy 78%
              </Button>
            </div>
          </div>
          <div className="border-t border-line pt-4" />
          <Slider label="Share of held dollars advanced (a)" value={x.advanceShare} min={0} max={1} step={0.05} onChange={(v) => set({ advanceShare: v })} format={(v) => pct(v)} />
          <Slider label="Fee on advanced dollars (f)" value={x.advanceFee} min={0.005} max={0.04} step={0.0025} onChange={(v) => set({ advanceFee: v })} format={(v) => pct(v, 2)} />
          <Slider label="Days an advance is outstanding" value={x.advanceDays} min={10} max={90} step={5} onChange={(v) => set({ advanceDays: v })} format={(v) => `${v} days`} />
          <Slider label="Cost of funds, annual" value={x.costOfFundsAnnual} min={0.01} max={0.09} step={0.0025} onChange={(v) => set({ costOfFundsAnnual: v })} format={(v) => pct(v, 2)} />
          <Slider label="Advance loss rate" value={x.advanceLossRate} min={0} max={0.02} step={0.0005} onChange={(v) => set({ advanceLossRate: v })} format={(v) => pct(v, 2)} />
          <div className="border-t border-line pt-4" />
          <Slider
            label="Yield Stripe earns on held balances"
            value={x.floatYield}
            min={0}
            max={0.05}
            step={0.0025}
            onChange={(v) => set({ floatYield: v })}
            format={(v) => pct(v, 2)}
            hint="Unknown from public sources. The PRD says to confirm with Finance before pitching; 0% assumes none."
          />
          <Toggle
            checked={x.includeHypotheses}
            onChange={(v) => set({ includeHypotheses: v })}
            label="Count retained volume"
            hint={`A hypothesis the PRD does not count: ${pct(x.retainedShareOfHeldVolume)} of held merchants' volume stays instead of leaving after a freeze, at ${pct(x.netTakeRate, 1)} net take.`}
          />
        </Card>

        <div className="space-y-4">
          <section className="card grid gap-px overflow-hidden bg-line sm:grid-cols-3">
            <Tile label="Merchant cash held on average" value={compactUsd(r.averageBalanceHeld)} sub={`${compactUsd(r.volumeHeldPerYear)} of volume held a year`} />
            <Tile label="Returned to merchants sooner" value={compactUsd(r.cashReturnedToMerchants)} sub="Average balance Thaw gives back" />
            <Tile label="Net to Stripe per year" value={compactUsd(r.net)} sub={x.floatYield === 0 ? 'Assuming held balances earn Stripe nothing' : `After ${pct(x.floatYield, 2)} float given up`} tone={r.net >= 0 ? 'good' : 'bad'} />
          </section>

          <Card>
            <CardHeader title="Where the money comes from and goes" subtitle="Annual, in dollars" />
            <ul className="space-y-2.5">
              {bridge.map((b) => (
                <li key={b.label} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 text-[13px] sm:grid-cols-[220px_1fr_90px]">
                  <span className="text-ink-2">{b.label}</span>
                  <div className="order-3 col-span-2 h-2 rounded-full bg-surface-2 sm:order-none sm:col-span-1">
                    <div className="h-2 rounded-full" style={{ width: `${(Math.abs(b.value) / scale) * 100}%`, background: b.kind === 'plus' ? 'var(--s1)' : 'var(--flat)' }} />
                  </div>
                  <span className="tabular text-right font-medium">{b.value >= 0 ? compactUsd(b.value) : `−${compactUsd(-b.value)}`}</span>
                </li>
              ))}
              <li className="grid grid-cols-[1fr_auto] items-center gap-4 border-t border-line pt-2.5 text-[13px] sm:grid-cols-[220px_1fr_90px]">
                <span className="font-semibold">Net contribution</span>
                <span className="hidden sm:block" />
                <span className={r.net >= 0 ? 'tabular text-right font-semibold text-good-ink' : 'tabular text-right font-semibold text-critical'}>{compactUsd(r.net)}</span>
              </li>
            </ul>
            <p className="mt-3 text-xs text-muted">
              Not counted: fewer hold-related support tickets, engineering and operations cost, and the appeals desk. The PRD treats retention and ticket savings as hypotheses to test.
            </p>
          </Card>

          <Card>
            <CardHeader
              title="The float question"
              subtitle="If Stripe earns interest on held balances, releasing them sooner gives some of it up. This is the number to confirm with Finance first."
            />
            <Callout tone={breakEvenYield > 0.04 ? 'good' : 'warn'}>
              Thaw covers the float it gives up as long as held balances earn Stripe less than <span className="font-semibold">{pct(breakEvenYield, 1)}</span> a year, with these inputs.
            </Callout>
            <div className="mt-3">
              <LineChart
                ariaLabel="Net contribution by yield on held balances"
                xs={yields}
                series={[{ key: 'net', label: 'Net contribution', color: 'var(--s1)', values: netByYield }]}
                xFormat={(v) => pct(v, 1)}
                tooltipTitle={(v) => `Float yield ${pct(v, 2)}`}
                yFormat={compactUsd}
                marker={{ x: Math.min(yields[yields.length - 1], Math.max(0, breakEvenYield)), label: 'Break-even' }}
                height={200}
              />
            </div>
            <p className="mt-1 text-xs text-muted">Net contribution per year (y) against the yield Stripe earns on held balances (x).</p>
          </Card>

          <Card>
            <CardHeader title="Sizing table from the PRD" subtitle={`Average balance held over ${x.holdDays} days, at ${compactUsd(x.annualVolume)} of annual volume`} />
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="py-1.5 font-medium">Share of volume held</th>
                  <th className="py-1.5 text-right font-medium">Volume held per year</th>
                  <th className="py-1.5 text-right font-medium">Average balance held</th>
                  <th className="py-1.5 text-right font-medium">Returned by Thaw</th>
                </tr>
              </thead>
              <tbody>
                {sizing.map((row) => (
                  <tr key={row.heldShare} className="border-b border-line last:border-0">
                    <td className="tabular py-2">{pct(row.heldShare, 1)}</td>
                    <td className="tabular py-2 text-right">{compactUsd(row.volumeHeldPerYear)}</td>
                    <td className="tabular py-2 text-right">{compactUsd(row.averageBalanceHeld)}</td>
                    <td className="tabular py-2 text-right font-medium">{compactUsd(row.averageBalanceHeld * x.dollarDaysCut)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      </div>
    </div>
  )
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="bg-surface p-5">
      <div className="text-[13px] text-ink-2">{label}</div>
      <div className={tone === 'bad' ? 'mt-1 text-3xl font-semibold tracking-tight text-critical' : 'mt-1 text-3xl font-semibold tracking-tight'}>{value}</div>
      <div className="mt-1 text-[13px] text-muted">{sub}</div>
    </div>
  )
}
