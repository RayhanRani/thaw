import { money } from '../lib/format'
import { useDemo } from '../state/demo'
import { Compare, Pane, StatusPill } from '../ui'
import { AnimatedNumber } from '../ui/motion'

/**
 * The same money, shown the same way on both views: what Thaw holds against today's reserve,
 * and why, in three plain reasons.
 */
export function HeldSummary({ label, backText, switchedText }: { label: string; backText: string; switchedText: string }) {
  const { snapshot: s, killSwitchOn } = useDemo()
  const back = Math.max(0, s.flatHeld - s.held)
  const reasons = [
    { label: 'Waiting on delivery', value: s.byType.not_received + s.floorTopUp, color: 'var(--s2)' },
    { label: 'Not verified at checkout', value: s.byType.fraud, color: 'var(--s1)' },
    { label: 'Normal dispute window', value: s.byType.not_as_described + s.byType.credit_not_processed, color: 'var(--s4)' },
  ]
  return (
    <Pane label={label} aside={<StatusPill onThaw={!killSwitchOn} />}>
      <div className="t-figure text-gradient mt-5">
        <AnimatedNumber value={s.held} format={(v) => money(v)} />
      </div>
      <div className={killSwitchOn ? 'mt-3 text-[16px] font-medium text-[#f08a8d]' : 'mt-3 text-[16px] font-medium text-good-ink'}>
        {killSwitchOn ? (
          switchedText
        ) : (
          <>
            <AnimatedNumber value={back} format={(v) => money(v)} /> {backText}
          </>
        )}
      </div>
      <Compare
        className="mt-8"
        size="lg"
        rows={[
          { name: 'Today', value: s.flatHeld, text: money(s.flatHeld) },
          { name: 'Thaw', value: s.held, text: <AnimatedNumber value={s.held} format={(v) => money(v)} />, thaw: true },
        ]}
      />
      <div className="mt-auto pt-8">
        <div className="t-label border-t border-sky-300/10 pt-6">Why it’s held</div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3 sm:gap-4">
          {reasons.map((r) => (
            <div key={r.label} className="flex min-w-0 items-center justify-between gap-3 sm:block">
              <div className="flex items-center gap-2 text-[13px] text-ink-2">
                <span className="size-2 shrink-0 rounded-full" style={{ background: r.color }} />
                <span className="truncate">{r.label}</span>
              </div>
              <div className="tabular text-[17px] font-semibold text-ink sm:mt-1 sm:text-[19px]">
                <AnimatedNumber value={r.value} format={(v) => money(v)} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </Pane>
  )
}
