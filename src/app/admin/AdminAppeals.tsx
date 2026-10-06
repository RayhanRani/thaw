import { useState } from 'react'
import { AppealError, isOverdue, reasonCopy, type Appeal, type AppealOutcome } from '../../engine'
import { dateLabel, money, plural } from '../lib/format'
import { PageHeader } from '../shell/AppShell'
import { href } from '../shell/routes'
import { demoNow, useDemo } from '../state/demo'
import { Badge, Button, Card, CardHeader, Segmented } from '../ui'
import { useToast } from '../ui/motion'

export function AdminAppeals() {
  return (
    <>
      <PageHeader
        eyebrow="Appeals queue"
        title="Every appeal answered in writing, on time"
        subtitle="Appeals carry a deadline in business days. Above the dollar threshold, only a human reviewer can decide."
      />
      <AppealsQueue />
    </>
  )
}

function AppealsQueue() {
  const { appeals, today, startAppealReview } = useDemo()
  const now = demoNow(today, 120)
  return (
    <Card>
      <CardHeader
        title="Appeals desk"
        subtitle="Each appeal has a deadline and needs a written decision. Above the threshold, only a human can decide it."
        action={<span className="text-[13px] text-muted">{plural(appeals.filter((a) => a.status !== 'decided').length, 'open appeal')}</span>}
      />
      {appeals.length === 0 ? (
        <p className="text-[13px] text-ink-2">
          No appeals yet. In the{' '}
          <a className="font-medium text-accent-ink hover:underline" href={href('merchant')}>
            merchant view
          </a>
          , open a held order (try the Flagged filter and a Radar hold) and choose "Contest this hold".
        </p>
      ) : (
        <ul className="space-y-3">
          {appeals.map((a) => (
            <li key={a.id} className="rounded-lg border border-line p-3.5 text-[13px]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-medium">
                  {a.id} · {reasonCopy(a.reasonCode).title} · {money(a.amountAtIssue, { cents: true })}
                  {a.paymentId && <span className="ml-2 font-mono text-xs text-muted">{a.paymentId}</span>}
                </div>
                <div className="flex items-center gap-2">
                  {a.requiresHumanReview && <Badge tone="accent">Human review</Badge>}
                  {a.status === 'decided' ? (
                    <Badge tone="good" dot>
                      Decided
                    </Badge>
                  ) : isOverdue(a, now) ? (
                    <Badge tone="critical" dot>
                      Overdue since {dateLabel(a.dueBy)}
                    </Badge>
                  ) : (
                    <Badge tone="warn" dot>
                      Due {dateLabel(a.dueBy)}
                    </Badge>
                  )}
                </div>
              </div>
              <p className="mt-1 text-ink-2">"{a.statement}"</p>
              {a.evidence.length > 0 && <p className="text-xs text-muted">Evidence: {a.evidence.join(', ')}</p>}
              {a.status === 'submitted' && (
                <Button size="sm" className="mt-2" onClick={() => startAppealReview(a.id)}>
                  Start review
                </Button>
              )}
              {a.status === 'in_review' && <DecideForm appeal={a} />}
              {a.decision && (
                <div className="mt-2 rounded-md bg-surface-2 p-2.5">
                  <span className="font-medium">{a.decision.outcome.replace('_', ' ')}</span> · {money(a.decision.releasedAmount, { cents: true })} released · {a.decision.reviewer}
                  <div className="text-ink-2">{a.decision.explanation}</div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function DecideForm({ appeal }: { appeal: Appeal }) {
  const { decideAppeal } = useDemo()
  const toast = useToast()
  const [outcome, setOutcome] = useState<AppealOutcome>('released')
  const [explanation, setExplanation] = useState('')
  const [reviewer, setReviewer] = useState<'human' | 'automated'>(appeal.requiresHumanReview ? 'human' : 'automated')
  const [error, setError] = useState<string | null>(null)
  const released = outcome === 'released' ? appeal.amountAtIssue : outcome === 'partially_released' ? Math.round(appeal.amountAtIssue / 2) : 0
  return (
    <form
      className="mt-3 space-y-2.5 border-t border-line pt-3"
      onSubmit={(e) => {
        e.preventDefault()
        try {
          decideAppeal(appeal.id, { outcome, releasedAmount: released, explanation, reviewer })
          setError(null)
          toast({ title: `Decision sent for ${appeal.id}`, body: released > 0 ? `${money(released, { cents: true })} released. The merchant sees your written explanation.` : 'Hold upheld. The merchant sees your written explanation.', tone: 'good' })
        } catch (err) {
          setError(err instanceof AppealError ? err.message : String(err))
        }
      }}
    >
      <div className="flex flex-wrap gap-2">
        <Segmented<AppealOutcome>
          label="Outcome"
          value={outcome}
          onChange={setOutcome}
          options={[
            { value: 'released', label: 'Release' },
            { value: 'partially_released', label: 'Release half' },
            { value: 'upheld', label: 'Uphold' },
          ]}
        />
        <Segmented
          label="Reviewer"
          value={reviewer}
          onChange={setReviewer}
          options={[
            { value: 'human', label: 'Human' },
            { value: 'automated', label: 'Automated' },
          ]}
        />
      </div>
      <textarea
        className="w-full rounded-lg border border-line bg-surface p-2 text-[13px]"
        rows={2}
        value={explanation}
        onChange={(e) => setExplanation(e.target.value)}
        placeholder="Written decision the merchant will read, e.g. We confirmed the gift address with the cardholder, so the Radar hold is lifted."
      />
      {error && <div className="text-critical">{error}</div>}
      <Button type="submit" variant="primary" size="sm">
        Send decision
      </Button>
    </form>
  )
}

