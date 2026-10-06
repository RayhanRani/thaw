import { isOverdue, reasonCopy } from '../../engine'
import { dateLabel, dayLabel, money } from '../lib/format'
import { demoNow, useDemo } from '../state/demo'
import { Badge, Card, CardHeader } from '../ui'

/** PRD 5.2: appeals with a stated deadline and a written decision; plus recent account activity. */
export function AppealsCard() {
  const { appeals, activity, today } = useDemo()
  const now = demoNow(today, 120)
  return (
    <Card>
      <CardHeader title="Appeals and activity" subtitle="Every appeal gets a written decision by a stated date" />
      {appeals.length === 0 ? (
        <p className="text-[13px] text-ink-2">No appeals yet. Open any held order and choose "Contest this hold".</p>
      ) : (
        <ul className="space-y-2.5">
          {appeals.map((a) => (
            <li key={a.id} className="rounded-lg border border-line p-3 text-[13px]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">
                  {reasonCopy(a.reasonCode).title} · {money(a.amountAtIssue, { cents: true })}
                </span>
                {a.status === 'decided' ? (
                  <Badge tone={a.decision!.releasedAmount > 0 ? 'good' : 'neutral'} dot>
                    {a.decision!.outcome.replace('_', ' ')}
                  </Badge>
                ) : isOverdue(a, now) ? (
                  <Badge tone="critical" dot>
                    Past its deadline
                  </Badge>
                ) : (
                  <Badge tone="accent" dot>
                    {a.status === 'in_review' ? 'In review' : 'Submitted'}
                  </Badge>
                )}
              </div>
              <div className="mt-0.5 text-ink-2">
                {a.status === 'decided' ? (
                  <>
                    <span className="text-ink">Decision ({a.decision!.reviewer}):</span> {a.decision!.explanation}
                  </>
                ) : (
                  <>Written decision due by {dateLabel(a.dueBy)}{a.requiresHumanReview ? ' · a Risk analyst will decide this one' : ''}</>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {activity.length > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted">Recent activity</div>
          <ul className="space-y-1.5 text-[13px]">
            {activity.slice(0, 6).map((a, i) => (
              <li key={i} className="flex gap-2">
                <span className="w-12 shrink-0 text-muted">{dayLabel(a.day)}</span>
                <span className="text-ink-2">{a.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}
