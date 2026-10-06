/**
 * Demo state: one merchant, a movable "today", and everything the merchant and Risk can do to
 * it (add proof, appeal, take an advance, change policy, flip the kill switch). All numbers are
 * derived from the engine on every change; nothing is precomputed.
 */

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  accountSeries,
  accountSnapshot,
  authenticationUpside,
  decideAppeal as decideAppealEngine,
  DEFAULT_APPEAL_POLICY,
  PILOT_POLICY,
  PRD_TOY_MODEL,
  projectAccountReleases,
  ProofApi,
  quoteAdvance,
  speedUpList,
  startReview,
  submitAppeal as submitAppealEngine,
  THAW_PILOT_MODEL,
  type Appeal,
  type AppealDecision,
  type Cents,
  type Day,
  type DisputeSignal,
  type PricingContext,
  type ProofEvent,
  type ReasonCode,
  type ReservePolicy,
} from '../../engine'
import { buildDemoWorld, dayToDate, DEMO_TODAY, type DemoOrder } from '../demo/merchant'

export type ModelId = 'pilot' | 'toy'

export interface ActiveAdvance {
  amount: Cents
  fee: Cents
  total: Cents
  acceptedDay: Day
}

export interface ActivityItem {
  day: Day
  text: string
  tone: 'release' | 'hold' | 'neutral'
}

interface DemoContextValue {
  today: Day
  setToday: (day: Day) => void
  modelId: ModelId
  setModelId: (id: ModelId) => void
  policy: ReservePolicy
  setPolicy: (p: Partial<ReservePolicy>) => void
  ctx: PricingContext
  orders: DemoOrder[]
  visible: DemoOrder[]
  byId: Map<string, DemoOrder>
  snapshot: ReturnType<typeof accountSnapshot>
  releases: ReturnType<typeof projectAccountReleases>
  speedUp: ReturnType<typeof speedUpList>
  authUpside: ReturnType<typeof authenticationUpside>
  disputeSignal: DisputeSignal
  advanceQuote: (amount: Cents | 'max') => ReturnType<typeof quoteAdvance>
  advance: ActiveAdvance | null
  advanceRepaid: Cents
  acceptAdvance: (amount: Cents) => void
  addTracking: (ids: string[]) => { verified: number; pending: number; rejected: number; messages: string[] }
  appeals: Appeal[]
  submitAppeal: (input: { paymentId?: string; reasonCode: ReasonCode; amountAtIssue: Cents; statement: string; evidence: string[] }) => Appeal
  startAppealReview: (id: string) => void
  decideAppeal: (id: string, decision: Omit<AppealDecision, 'decidedAt'>) => void
  radarCleared: Set<string>
  activity: ActivityItem[]
  killSwitchOn: boolean
  setKillSwitch: (on: boolean) => void
  reset: () => void
}

const DemoContext = createContext<DemoContextValue | null>(null)

export function useDemo(): DemoContextValue {
  const ctx = useContext(DemoContext)
  if (!ctx) throw new Error('useDemo outside DemoProvider')
  return ctx
}

/** A timestamp on the demo's calendar for a given day, so appeal deadlines use real dates. */
export function demoNow(day: Day, minutes = 0): Date {
  const d = dayToDate(day)
  d.setHours(10, minutes, 0, 0)
  return d
}

export function DemoProvider({ children }: { children: ReactNode }) {
  const world = useMemo(() => buildDemoWorld(), [])
  const [today, setTodayRaw] = useState<Day>(DEMO_TODAY)
  const [modelId, setModelId] = useState<ModelId>('pilot')
  const [policy, setPolicyRaw] = useState<ReservePolicy>(PILOT_POLICY)
  const [added, setAdded] = useState<Record<string, ProofEvent[]>>({})
  const [radarCleared, setRadarCleared] = useState<Set<string>>(new Set())
  const [appeals, setAppeals] = useState<Appeal[]>([])
  const [advance, setAdvance] = useState<ActiveAdvance | null>(null)
  const [activity, setActivity] = useState<ActivityItem[]>([])
  const todayRef = useRef(today)
  todayRef.current = today

  const ordersRef = useRef<DemoOrder[]>([])
  const proofApi = useRef<ProofApi | null>(null)
  if (!proofApi.current) {
    proofApi.current = new ProofApi(world.carrier, (id) => ordersRef.current.find((o) => o.payment.id === id)?.payment)
  }

  const orders = useMemo<DemoOrder[]>(
    () =>
      world.orders.map((o) => {
        const extra = added[o.payment.id]
        const cleared = radarCleared.has(o.payment.id)
        if (!extra && !cleared) return o
        return {
          ...o,
          payment: cleared ? { ...o.payment, radarFlag: undefined } : o.payment,
          proofs: extra ? [...o.proofs, ...extra] : o.proofs,
        }
      }),
    [world, added, radarCleared],
  )
  ordersRef.current = orders
  const byId = useMemo(() => new Map(orders.map((o) => [o.payment.id, o])), [orders])
  const visible = useMemo(() => orders.filter((o) => o.payment.capturedDay <= today), [orders, today])

  const ctx = useMemo<PricingContext>(() => ({ model: modelId === 'toy' ? PRD_TOY_MODEL : THAW_PILOT_MODEL, policy }), [modelId, policy])
  const snapshot = useMemo(() => accountSnapshot(visible, today, ctx), [visible, today, ctx])
  const releases = useMemo(() => projectAccountReleases(visible, today, ctx), [visible, today, ctx])
  const speedUp = useMemo(() => speedUpList(visible, today, ctx), [visible, today, ctx])
  const authUpside = useMemo(() => authenticationUpside(visible, today, ctx), [visible, today, ctx])

  const disputeSignal = useMemo<DisputeSignal>(() => {
    const disputesIn = (from: Day, to: Day) =>
      visible.reduce((n, o) => n + o.adverse.filter((e) => e.kind === 'dispute' && e.day > from && e.day <= to).length, 0)
    const ordersIn = (from: Day, to: Day) => visible.filter((o) => o.payment.capturedDay > from && o.payment.capturedDay <= to).length
    return {
      recentRate: disputesIn(today - 30, today) / Math.max(1, ordersIn(today - 30, today)),
      baselineRate: disputesIn(today - 120, today - 30) / Math.max(1, ordersIn(today - 120, today - 30)),
    }
  }, [visible, today])

  const killSwitchOn = policy.killSwitchDay !== undefined && policy.killSwitchDay <= today

  const advanceQuote = useCallback(
    (amount: Cents | 'max') => quoteAdvance(releases, today, amount, { model: ctx.model, policy, signal: disputeSignal, killSwitch: killSwitchOn }),
    [releases, today, ctx, policy, disputeSignal, killSwitchOn],
  )

  const advanceRepaid = useMemo(() => {
    if (!advance || today <= advance.acceptedDay) return 0
    const cohort = orders.filter((o) => o.payment.capturedDay <= advance.acceptedDay)
    const s = accountSeries(cohort, today, ctx, advance.acceptedDay, today)
    const released = Math.max(0, s[0].thaw - s[s.length - 1].thaw)
    return Math.min(advance.total, released)
  }, [advance, orders, today, ctx])

  const log = useCallback((text: string, tone: ActivityItem['tone'] = 'neutral') => {
    setActivity((a) => [{ day: todayRef.current, text, tone }, ...a].slice(0, 50))
  }, [])

  const setToday = useCallback(
    (day: Day) => {
      const from = todayRef.current
      if (day > from && proofApi.current) {
        const verified: ProofEvent[] = []
        for (let d = from + 1; d <= day; d++) verified.push(...proofApi.current.poll(d))
        if (verified.length) {
          setAdded((prev) => {
            const next = { ...prev }
            for (const e of verified) next[e.paymentId] = [...(next[e.paymentId] ?? []), e]
            return next
          })
          setActivity((a) => [{ day, text: `Carrier confirmed delivery on ${verified.length} order${verified.length === 1 ? '' : 's'} you added tracking to.`, tone: 'release' as const }, ...a])
        }
      }
      setTodayRaw(day)
    },
    [],
  )

  const addTracking = useCallback(
    (ids: string[]) => {
      const api = proofApi.current!
      const out = { verified: 0, pending: 0, rejected: 0, messages: [] as string[] }
      const events: ProofEvent[] = []
      for (const id of ids) {
        const o = ordersRef.current.find((x) => x.payment.id === id)
        if (!o) continue
        const res = api.submit(
          { type: 'shipment', payment: id, carrier: o.meta.carrier, tracking_number: o.meta.trackingNumber },
          `idem_${id}_${o.meta.trackingNumber}`,
          todayRef.current,
        )
        events.push(...res.events)
        if (res.status === 'verified') out.verified++
        else if (res.status === 'pending_verification') out.pending++
        else out.rejected++
        if (ids.length === 1) out.messages.push(res.message)
      }
      if (events.length) {
        setAdded((prev) => {
          const next = { ...prev }
          for (const e of events) {
            const existing = next[e.paymentId] ?? []
            if (!existing.some((x) => x.id === e.id)) next[e.paymentId] = [...existing, e]
          }
          return next
        })
      }
      log(
        `Added tracking to ${ids.length} order${ids.length === 1 ? '' : 's'}: ${out.verified} confirmed by the carrier, ${out.pending} in transit${out.rejected ? `, ${out.rejected} not found` : ''}.`,
        out.verified ? 'release' : 'neutral',
      )
      return out
    },
    [log],
  )

  const submitAppeal = useCallback<DemoContextValue['submitAppeal']>(
    (input) => {
      const appeal = submitAppealEngine({ merchantId: 'acct_clayhouse', ...input }, demoNow(todayRef.current, appeals.length), DEFAULT_APPEAL_POLICY)
      setAppeals((a) => [appeal, ...a])
      log(`Appeal ${appeal.id} submitted. Written decision due by ${appeal.dueBy.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}.`)
      return appeal
    },
    [appeals.length, log],
  )

  const startAppealReview = useCallback((id: string) => {
    setAppeals((list) => list.map((a) => (a.id === id ? startReview(a, demoNow(todayRef.current, 30)) : a)))
  }, [])

  const decideAppeal = useCallback(
    (id: string, decision: Omit<AppealDecision, 'decidedAt'>) => {
      const appeal = appeals.find((a) => a.id === id)
      if (!appeal) return
      const decided = decideAppealEngine(appeal, decision, demoNow(todayRef.current, 90))
      setAppeals((list) => list.map((a) => (a.id === id ? decided : a)))
      if (decision.releasedAmount > 0 && appeal.paymentId && appeal.reasonCode === 'RADAR_BLOCK') {
        setRadarCleared((s) => new Set([...s, appeal.paymentId!]))
      }
      log(`Appeal ${id} decided: ${decided.decision!.outcome.replace('_', ' ')}.`, decision.releasedAmount > 0 ? 'release' : 'hold')
    },
    [appeals, log],
  )

  const acceptAdvance = useCallback(
    (amount: Cents) => {
      const q = advanceQuote(amount)
      if (!q.eligible || q.amount <= 0) return
      setAdvance({ amount: q.amount, fee: q.fee, total: q.totalRepayment, acceptedDay: todayRef.current })
      log(`Thaw Advance of $${(q.amount / 100).toFixed(2)} accepted. Fee $${(q.fee / 100).toFixed(2)}, repaid from scheduled releases.`, 'release')
    },
    [advanceQuote, log],
  )

  const setPolicy = useCallback((p: Partial<ReservePolicy>) => setPolicyRaw((cur) => ({ ...cur, ...p })), [])

  const setKillSwitch = useCallback(
    (on: boolean) => {
      setPolicyRaw((cur) => ({ ...cur, killSwitchDay: on ? todayRef.current : undefined }))
      log(on ? 'Risk moved this account to the standard reserve schedule (kill switch).' : 'Risk returned this account to Thaw.', on ? 'hold' : 'release')
    },
    [log],
  )

  const reset = useCallback(() => {
    proofApi.current = new ProofApi(world.carrier, (id) => ordersRef.current.find((o) => o.payment.id === id)?.payment)
    setTodayRaw(DEMO_TODAY)
    setModelId('pilot')
    setPolicyRaw(PILOT_POLICY)
    setAdded({})
    setRadarCleared(new Set())
    setAppeals([])
    setAdvance(null)
    setActivity([])
  }, [world])

  const value: DemoContextValue = {
    today,
    setToday,
    modelId,
    setModelId,
    policy,
    setPolicy,
    ctx,
    orders,
    visible,
    byId,
    snapshot,
    releases,
    speedUp,
    authUpside,
    disputeSignal,
    advanceQuote,
    advance,
    advanceRepaid,
    acceptAdvance,
    addTracking,
    appeals,
    submitAppeal,
    startAppealReview,
    decideAppeal,
    radarCleared,
    activity,
    killSwitchOn,
    setKillSwitch,
    reset,
  }
  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>
}

