import { FlaskConical, Milestone } from 'lucide-react'
import snapshot from '../data/snapshot.json'
import { PlayButton, SimChart, SimReadout, usePlayer } from '../shared/SimChart'
import { cx, Pane, SplitCard } from '../ui'

// From the shadow backtest: the share of an order's reserve still held at each age, averaged over
// every simulated order. Today's reserve holds all of it until day 90.
const CURVE = snapshot.defaultResult.release.curve
const RESERVE = 100 // dollars held from a $1,000 sale at the 10% reserve
const DATA = CURVE.map((c) => ({ a: c.flat * RESERVE, b: c.thaw * RESERVE }))
const ORDERS = snapshot.defaultResult.orders

const usd = (v: number) => `$${Math.round(v)}`
const backAt = (day: number) => RESERVE - DATA[day].b

const MOMENTS = [
  { day: 0, title: 'Payment verified at checkout', note: `${usd(backAt(0))} back on the spot` },
  { day: snapshot.figures.medianDaysThaw, title: 'Half is back', note: `${usd(backAt(snapshot.figures.medianDaysThaw))} back by day ${snapshot.figures.medianDaysThaw}` },
  { day: 30, title: 'Most disputes have arrived', note: `${usd(backAt(30))} back by day 30` },
  { day: 90, title: 'Today’s reserve finally lets go', note: 'Thaw had already released almost all of it' },
]

/** The research, for a merchant: what happens to the money held from one sale, day by day. */
export function SaleSimulation() {
  const { at, playing, toggle, seek } = usePlayer(DATA.length, 70)
  const p = DATA[at]
  const current = [...MOMENTS].reverse().find((m) => at >= m.day)

  return (
    <SplitCard>
      <Pane label={`Day ${at} after a $1,000 sale`} icon={FlaskConical} aside={<PlayButton playing={playing} atEnd={at >= DATA.length - 1} onClick={toggle} />}>
        <div className="mt-5">
          <SimReadout
            items={[
              { label: 'Today’s reserve holds', value: usd(p.a), tone: 'today' },
              { label: 'Thaw holds', value: usd(p.b), tone: 'thaw' },
              { label: 'Back early', value: usd(Math.max(0, p.a - p.b)), tone: 'good' },
            ]}
          />
        </div>
        <div className="mt-8">
          <SimChart
            data={DATA}
            at={at}
            onSeek={seek}
            ticks={[
              { i: 0, label: 'Day 0' },
              { i: 30, label: 'Day 30' },
              { i: 60, label: 'Day 60' },
              { i: 90, label: 'Day 90' },
            ]}
          />
        </div>
      </Pane>

      <Pane label="Key moments" icon={Milestone} act>
        <div className="-mx-3 mt-4 space-y-1">
          {MOMENTS.map((m) => (
            <button
              key={m.day}
              onClick={() => seek(m.day)}
              className={cx(
                'flex w-full items-center gap-4 rounded-xl px-3 py-3 text-left transition-colors',
                current === m ? 'bg-sky-400/[0.08] ring-1 ring-sky-300/25' : 'hover:bg-white/[0.04]',
              )}
            >
              <span
                className={cx(
                  'flex h-9 w-14 shrink-0 items-center justify-center rounded-lg text-[13px] font-semibold tabular',
                  current === m ? 'ice-tile' : 'bg-white/[0.06] text-ink-2',
                )}
              >
                Day {m.day}
              </span>
              <span className="min-w-0">
                <span className="block text-[15px] font-medium text-ink">{m.title}</span>
                <span className="block text-[13px] text-ink-2">{m.note}</span>
              </span>
            </button>
          ))}
        </div>
        <p className="t-small mt-auto pt-6">Averaged over {ORDERS.toLocaleString('en-US')} orders from my simulation of 300 stores. Press play, drag the chart, or pick a moment.</p>
      </Pane>
    </SplitCard>
  )
}
