/**
 * Fair process (PRD section 5): appeals with a stated response deadline, a written decision,
 * and human review above a dollar threshold set by Risk.
 */

import type { Cents, ReasonCode } from './types'

export interface AppealPolicy {
  /** Business days Stripe commits to answer within. */
  responseBusinessDays: number
  /** Appeals over this amount always get a human reviewer (PRD 5.4). */
  humanReviewThreshold: Cents
}

export const DEFAULT_APPEAL_POLICY: AppealPolicy = {
  responseBusinessDays: 3,
  humanReviewThreshold: 5_000_00,
}

export type AppealStatus = 'submitted' | 'in_review' | 'decided'
export type AppealOutcome = 'released' | 'partially_released' | 'upheld'

export interface AppealDecision {
  outcome: AppealOutcome
  releasedAmount: Cents
  /** The written decision. Required: an appeal is never closed without one. */
  explanation: string
  decidedAt: Date
  reviewer: 'automated' | 'human'
}

export interface Appeal {
  id: string
  merchantId: string
  /** The order appealed, or undefined for an account-level hold. */
  paymentId?: string
  reasonCode: ReasonCode
  amountAtIssue: Cents
  statement: string
  evidence: string[]
  submittedAt: Date
  dueBy: Date
  requiresHumanReview: boolean
  status: AppealStatus
  decision?: AppealDecision
  history: { at: Date; status: AppealStatus; note: string }[]
}

export class AppealError extends Error {}

export function addBusinessDays(start: Date, days: number): Date {
  const d = new Date(start)
  let added = 0
  while (added < days) {
    d.setDate(d.getDate() + 1)
    const dow = d.getDay()
    if (dow !== 0 && dow !== 6) added++
  }
  return d
}

let seq = 0

export function submitAppeal(
  input: { merchantId: string; paymentId?: string; reasonCode: ReasonCode; amountAtIssue: Cents; statement: string; evidence?: string[] },
  now: Date,
  policy: AppealPolicy = DEFAULT_APPEAL_POLICY,
): Appeal {
  if (input.statement.trim().length < 10) throw new AppealError('Tell us in a sentence or two why this hold should change.')
  const requiresHumanReview = input.amountAtIssue >= policy.humanReviewThreshold
  return {
    id: `apl_${(++seq).toString().padStart(4, '0')}`,
    ...input,
    evidence: input.evidence ?? [],
    submittedAt: now,
    dueBy: addBusinessDays(now, policy.responseBusinessDays),
    requiresHumanReview,
    status: 'submitted',
    history: [
      {
        at: now,
        status: 'submitted',
        note: requiresHumanReview
          ? `Submitted. Over the human-review threshold, so a Risk analyst will decide it.`
          : 'Submitted.',
      },
    ],
  }
}

export function startReview(appeal: Appeal, now: Date): Appeal {
  if (appeal.status !== 'submitted') throw new AppealError(`Cannot start review from "${appeal.status}".`)
  return { ...appeal, status: 'in_review', history: [...appeal.history, { at: now, status: 'in_review', note: 'A reviewer picked this up.' }] }
}

export function decideAppeal(appeal: Appeal, decision: Omit<AppealDecision, 'decidedAt'>, now: Date): Appeal {
  if (appeal.status === 'decided') throw new AppealError('This appeal already has a decision.')
  if (decision.explanation.trim().length < 20) throw new AppealError('A decision needs a written explanation the merchant can act on.')
  if (appeal.requiresHumanReview && decision.reviewer !== 'human') {
    throw new AppealError('Appeals over the threshold must be decided by a human reviewer.')
  }
  if (decision.releasedAmount < 0 || decision.releasedAmount > appeal.amountAtIssue) {
    throw new AppealError('Released amount must be between zero and the amount at issue.')
  }
  const outcome: AppealOutcome =
    decision.releasedAmount === 0 ? 'upheld' : decision.releasedAmount < appeal.amountAtIssue ? 'partially_released' : 'released'
  if (outcome !== decision.outcome) throw new AppealError(`Released amount implies "${outcome}", not "${decision.outcome}".`)
  return {
    ...appeal,
    status: 'decided',
    decision: { ...decision, decidedAt: now },
    history: [...appeal.history, { at: now, status: 'decided', note: `Decided: ${outcome.replace('_', ' ')}.` }],
  }
}

export function isOverdue(appeal: Appeal, now: Date): boolean {
  const decidedAt = appeal.decision?.decidedAt
  return (decidedAt ?? now).getTime() > appeal.dueBy.getTime()
}

/** PRD metric: median hours from appeal to written decision. */
export function medianTurnaroundHours(appeals: Appeal[]): number | null {
  const hours = appeals
    .filter((a) => a.decision)
    .map((a) => (a.decision!.decidedAt.getTime() - a.submittedAt.getTime()) / 36e5)
    .sort((a, b) => a - b)
  if (hours.length === 0) return null
  const mid = Math.floor(hours.length / 2)
  return hours.length % 2 ? hours[mid] : (hours[mid - 1] + hours[mid]) / 2
}
