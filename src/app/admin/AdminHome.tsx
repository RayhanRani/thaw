import { ArrowRight, Check, ListChecks, ShieldAlert, ShieldCheck, X } from 'lucide-react'
import { useState } from 'react'
import snapshot from '../data/snapshot.json'
import { PageHeader, SectionHead } from '../shell/AppShell'
import { href } from '../shell/routes'
import { HeldSummary } from '../shared/HeldSummary'
import { useDemo } from '../state/demo'
import { Compare, cx, Pane, SplitCard } from '../ui'
import { AnimatedNumber, useToast } from '../ui/motion'
import { YearSimulation } from './YearSimulation'

/** The admin view, as three questions the risk team would ask. The last two are answered by the research simulation. */
export function AdminHome() {
  return (
    <>
      <PageHeader eyebrow="Admin View" title="Stripe’s Risk Team" subtitle="The same store, seen by Stripe’s risk team, plus what my simulation of 300 stores says about safety." />
      <div>
        <SectionHead n="01" title="What’s happening with this store?" sub="The same money Maya sees, and the switch that puts her back on today’s reserve." />
        <SplitCard>
          <HeldSummary label="Clayhouse Studio · money on hold" backText="released early" switchedText="Back on today’s reserve" />
          <SafetySwitch />
        </SplitCard>
        <SectionHead n="02" title="Simulation: a year across 300 stores" sub="I replayed a year of payments, including stores that fail and stores that cheat, under today’s rules and under Thaw." />
        <YearSimulation />
        <SectionHead n="03" title="Stress test: is it safe?" sub="Pick a test. Each one is six simulated years of the same 300 stores." />
        <StressTest />
      </div>
    </>
  )
}

/** The kill switch as a two-way choice, so the current state is always obvious. */
function SafetySwitch() {
  const { killSwitchOn, setKillSwitch } = useDemo()
  const toast = useToast()
  const choose = (toReserve: boolean) => {
    if (toReserve === killSwitchOn) return
    setKillSwitch(toReserve)
    toast(
      toReserve
        ? { title: 'Back on today’s reserve', body: 'Maya’s view now shows the standard hold.', tone: 'warn' }
        : { title: 'Thaw is back on', body: 'Orders release as proof arrives again.', tone: 'good' },
    )
  }
  return (
    <Pane label="Safety switch" icon={killSwitchOn ? ShieldAlert : ShieldCheck} act>
      <div className={cx('mt-5 text-[34px] font-semibold leading-none tracking-[-0.03em]', killSwitchOn ? 'text-[#f08a8d]' : 'text-gradient')}>
        {killSwitchOn ? 'Today’s reserve' : 'On Thaw'}
      </div>
      <p className="t-body mt-4">
        {killSwitchOn
          ? 'Every order is held the full 10% for 90 days until Risk turns Thaw back on.'
          : 'If something looks wrong, like a spike in sales or disputes, put this store back on today’s reserve instantly.'}
      </p>
      <div className="mt-auto pt-8">
        <div role="radiogroup" aria-label="Reserve for this store" className="grid grid-cols-2 gap-1 rounded-full border border-white/10 bg-white/[0.04] p-1">
          <button
            role="radio"
            aria-checked={!killSwitchOn}
            onClick={() => choose(false)}
            className={cx(
              'h-11 rounded-full text-[15px] font-semibold transition-colors',
              !killSwitchOn ? 'bg-gradient-to-r from-sky-300 to-emerald-300 text-slate-950 shadow-lg shadow-sky-500/25' : 'text-ink-2 hover:text-ink',
            )}
          >
            On Thaw
          </button>
          <button
            role="radio"
            aria-checked={killSwitchOn}
            onClick={() => choose(true)}
            className={cx('h-11 rounded-full text-[15px] font-semibold transition-colors', killSwitchOn ? 'bg-critical text-white shadow-lg shadow-red-500/20' : 'text-ink-2 hover:text-ink')}
          >
            Today’s reserve
          </button>
        </div>
        <a href={href('merchant')} className="mt-4 flex items-center justify-center gap-1.5 text-[14px] font-medium text-ink-2 hover:text-ink">
          See what Maya sees <ArrowRight className="size-4" />
        </a>
      </div>
    </Pane>
  )
}

type Row = (typeof snapshot.base)[number]
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length

interface Test {
  id: string
  title: string
  hint: string
  rows: Row[]
  floor: boolean
  story: (safe: number, total: number, cut: number) => string
}

const TESTS: Test[] = [
  {
    id: 'normal',
    title: 'A normal year',
    hint: 'Thaw as designed, with the safety minimum',
    rows: snapshot.base,
    floor: true,
    story: () => 'About half the money comes back early, and losses stay where they are today.',
  },
  {
    id: 'nofloor',
    title: 'No safety minimum',
    hint: 'Release every proven order, keep nothing back',
    rows: snapshot.base,
    floor: false,
    story: (s, t) =>
      `More comes back early, but losses go over the limit in ${t - s} of ${t} years: when a store goes under, the money that covered its unshipped orders is already gone. That’s why the safety minimum exists.`,
  },
  {
    id: 'stress',
    title: 'Three times more stores fail',
    hint: 'A bad year for small businesses',
    rows: snapshot.stress,
    floor: true,
    story: () => 'Even with three times as many failures, losses stay level. The safety switch catches more failing stores early.',
  },
  {
    id: 'scam',
    title: 'Scammers fake delivery proof',
    hint: 'Empty boxes shipped with real tracking numbers',
    rows: snapshot.adversarial,
    floor: true,
    story: (s, t) => `Fake proof gets money released too early: losses go over the limit in ${t - s} of ${t} years. This is the real risk.`,
  },
  {
    id: 'fix',
    title: 'Scammers, but new stores start on today’s reserve',
    hint: 'Stores earn trust before Thaw applies',
    rows: snapshot.adversarialNewFlat,
    floor: true,
    story: (s, t, cut) => `Making new stores earn trust first closes the gap: safe in ${s} of ${t} years, and still ${Math.round(cut * 100)}% less money on hold.`,
  },
]

function score(t: Test) {
  const cut = mean(t.rows.map((r) => (t.floor ? r.cut : r.cutNoFloor)))
  const years = t.rows.map((r) => (t.floor ? r.lossDeltaBps : r.noFloorLossBps - r.controlLossBps) <= 0.5)
  return { cut, years, safe: years.filter(Boolean).length }
}

/** The study's main finding: pick a test on the right, see the result on the left. */
function StressTest() {
  const [id, setId] = useState('normal')
  const test = TESTS.find((t) => t.id === id)!
  const { cut, years, safe } = score(test)
  const allSafe = safe === years.length

  return (
    <SplitCard>
      <Pane label={test.title} icon={allSafe ? ShieldCheck : ShieldAlert}>
        <div className="t-figure text-gradient mt-5">
          <AnimatedNumber value={Math.round(cut * 100)} format={(v) => `${Math.round(v)}% less`} duration={500} />
        </div>
        <div className="mt-3 text-[16px] font-medium text-ink-2">money on hold than today’s reserve</div>
        <Compare
          className="mt-8"
          size="lg"
          rows={[
            { name: 'Today', value: 1, text: '100%' },
            { name: 'Thaw', value: 1 - cut, text: `${Math.round((1 - cut) * 100)}%`, thaw: true },
          ]}
        />
        <div className="mt-auto pt-8">
          <div className="t-label border-t border-sky-300/10 pt-6">Verdict</div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
            <div className={cx('flex items-center gap-2 text-[24px] font-semibold tracking-[-0.02em]', allSafe ? 'text-good-ink' : 'text-[#f08a8d]')}>
              {allSafe ? <ShieldCheck className="size-6" /> : <ShieldAlert className="size-6" />}
              {allSafe ? 'Safe' : 'Not safe enough'}
              <span className="ml-1 text-[15px] font-medium text-ink-2">
                {safe} of {years.length} years
              </span>
            </div>
            <div className="flex gap-1.5" aria-label={`${safe} of ${years.length} simulated years safe`}>
              {years.map((ok, i) => (
                <span
                  key={i}
                  title={`Simulated year ${i + 1}: ${ok ? 'safe' : 'losses too high'}`}
                  className={cx('flex size-7 items-center justify-center rounded-lg border transition-colors', ok ? 'border-good/30 bg-good-soft text-good-ink' : 'border-critical/40 bg-critical-soft text-[#f08a8d]')}
                >
                  {ok ? <Check className="size-4" /> : <X className="size-4" />}
                </span>
              ))}
            </div>
          </div>
          <p key={test.id} className="animate-fade-up mt-4 text-[15px] leading-relaxed text-ink">
            {test.story(safe, years.length, cut)}
          </p>
        </div>
      </Pane>

      <Pane label="Pick a test" icon={ListChecks} act>
        <div role="radiogroup" aria-label="Stress tests" className="-mx-3 mt-4 space-y-1">
          {TESTS.map((t) => {
            const r = score(t)
            const ok = r.safe === r.years.length
            const on = t.id === id
            return (
              <button
                key={t.id}
                role="radio"
                aria-checked={on}
                onClick={() => setId(t.id)}
                className={cx('flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors', on ? 'bg-sky-400/[0.08] ring-1 ring-sky-300/25' : 'hover:bg-white/[0.04]')}
              >
                <span className={cx('flex size-5 shrink-0 items-center justify-center rounded-full border-2', on ? 'border-sky-400' : 'border-slate-600')}>
                  {on && <span className="size-2 rounded-full bg-sky-400" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-medium text-ink">{t.title}</span>
                  <span className="block text-[13px] text-ink-2">{t.hint}</span>
                </span>
                <span className={cx('shrink-0 rounded-full px-2 py-0.5 text-[12px] font-semibold', ok ? 'bg-good-soft text-good-ink' : 'bg-critical-soft text-[#f08a8d]')}>
                  {ok ? 'Safe' : `${r.safe}/${r.years.length}`}
                </span>
              </button>
            )
          })}
        </div>
        <p className="t-small mt-auto pt-6">Safe means losses stayed within $50 per $1M processed of today’s, in every simulated year.</p>
      </Pane>
    </SplitCard>
  )
}
