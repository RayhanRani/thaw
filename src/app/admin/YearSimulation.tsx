import { FlaskConical, ListChecks, Scale, ShieldAlert, ShieldCheck, Store } from 'lucide-react'
import snapshot from '../data/snapshot.json'
import { compactUsd } from '../lib/format'
import { PlayButton, SimChart, SimReadout, usePlayer } from '../shared/SimChart'
import { Pane, SplitCard } from '../ui'

// From the shadow backtest: money held across all 300 stores, week by week, under today's reserve
// (control) and under Thaw (treatment), on the same payments, proof and disputes. Values are cents.
const R = snapshot.defaultResult
const DATA = R.heldOverTime.map((h) => ({ a: h.control / 100, b: h.treatment / 100 }))
const healthy = R.merchants - R.killSwitch.failingTotal

const FACTS = [
  {
    icon: Store,
    title: `${R.killSwitch.failingTotal} stores failed during the year`,
    note: `${R.failures.insolvent} went out of business and ${R.failures.bustOut} were scams, leaving disputes behind.`,
  },
  {
    icon: ShieldAlert,
    title: `The safety switch caught ${R.killSwitch.failing} of them`,
    note: `A median ${R.killSwitch.medianDaysBeforeFailure} days before they failed, by spotting drops in delivery proof and spikes in disputes or sales.`,
  },
  {
    icon: ShieldCheck,
    title: `Only ${R.killSwitch.healthy} healthy stores were flagged`,
    note: `Out of ${healthy} that never failed.`,
  },
  {
    icon: Scale,
    title: 'Losses: about the same as today',
    note: 'Within $50 per $1M processed of today’s reserve.',
  },
]

/** The research, for the risk team: a year of payments across 300 stores, replayed under both rules. */
export function YearSimulation() {
  // Opens on the end of the year (the result); Replay plays it from the start.
  const { at, playing, toggle, seek } = usePlayer(DATA.length, 110, DATA.length - 1)
  const p = DATA[at]
  const less = p.a > 0 ? 1 - p.b / p.a : 0

  return (
    <SplitCard>
      <Pane label={`Week ${at} of 52 · all 300 stores`} icon={FlaskConical} aside={<PlayButton playing={playing} atEnd={at >= DATA.length - 1} onClick={toggle} />}>
        <div className="mt-5">
          <SimReadout
            items={[
              { label: 'Today’s reserve holds', value: compactUsd(p.a), tone: 'today' },
              { label: 'Thaw holds', value: compactUsd(p.b), tone: 'thaw' },
              { label: 'Less held', value: `${Math.round(less * 100)}%`, tone: 'good' },
            ]}
          />
        </div>
        <div className="mt-8">
          <SimChart
            data={DATA}
            at={at}
            onSeek={seek}
            ticks={[
              { i: 0, label: 'Start' },
              { i: 13, label: '3 months' },
              { i: 26, label: '6 months' },
              { i: 39, label: '9 months' },
              { i: DATA.length - 1, label: '1 year' },
            ]}
          />
        </div>
      </Pane>

      <Pane label="What happened" icon={ListChecks} act>
        <ul className="mt-5 space-y-5">
          {FACTS.map((f) => (
            <li key={f.title} className="flex gap-3.5">
              <span className="ice-tile size-9 shrink-0 rounded-xl">
                <f.icon className="size-[18px]" />
              </span>
              <span className="min-w-0">
                <span className="block text-[15px] font-medium text-ink">{f.title}</span>
                <span className="block text-[13px] leading-relaxed text-ink-2">{f.note}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="t-small mt-auto pt-6">Same stores, same sales, same disputes: once under today’s rules and once under Thaw.</p>
      </Pane>
    </SplitCard>
  )
}
