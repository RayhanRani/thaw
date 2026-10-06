/**
 * Account-level views of the holdback engine: the balance held today, the Risk-set floor,
 * the projected release calendar (PRD 3.1) and the speed-up list (PRD 3.3).
 */

import { flatHoldback, priceHoldback, verifiedFulfillmentDay, type PricingContext } from './holdback'
import { tierOf } from './proof'
import { accountSeries } from './series'
import { DISPUTE_TYPES, type Cents, type Day, type DisputeType, type OrderState, type ProofKind } from './types'

const zeroByType = (): Record<DisputeType, number> => ({
  fraud: 0,
  not_received: 0,
  not_as_described: 0,
  credit_not_processed: 0,
})

/** Strip everything the engine could not have known on `day`. Used for projections and time travel. */
export function knownAsOf(order: OrderState, day: Day): OrderState {
  return {
    payment: order.payment,
    proofs: order.proofs.filter((p) => p.day <= day),
    adverse: order.adverse.filter((e) => e.day <= day),
  }
}

export function trailingVolume(orders: OrderState[], day: Day, days: number): Cents {
  let sum = 0
  for (const o of orders) {
    const age = day - o.payment.capturedDay
    if (age >= 0 && age < days) sum += o.payment.amount
  }
  return sum
}

export interface AccountSnapshot {
  day: Day
  /** Σ of order-level holdbacks. */
  ordersHeld: Cents
  /** Risk-set minimum for the account today. */
  floor: Cents
  /** Extra held because order-level cover is below the floor. */
  floorTopUp: Cents
  /** Total held today: max(orders, floor), within the cap. */
  held: Cents
  /** What the flat reserve would hold today. */
  flatHeld: Cents
  heldOrderCount: number
  byType: Record<DisputeType, number>
  trailingVolume: Cents
  /** Recent volume still lacking verified fulfillment proof (drives the unproven floor). */
  unprovenVolume: Cents
}

/** Volume captured in the trailing window that still lacks verified fulfillment proof on `day`. */
export function unprovenVolume(orders: OrderState[], day: Day, ctx: PricingContext): Cents {
  let sum = 0
  for (const o of orders) {
    const age = day - o.payment.capturedDay
    if (age < 0 || age >= ctx.policy.floorTrailingDays) continue
    const proven = verifiedFulfillmentDay(knownAsOf(o, day), ctx.model)
    if (proven === null || proven > day) sum += o.payment.amount
  }
  return sum
}

export function accountFloor(
  orders: OrderState[],
  day: Day,
  ctx: PricingContext,
): { floor: Cents; trailing: Cents; unproven: Cents } {
  const { policy } = ctx
  const trailing = trailingVolume(orders, day, policy.floorTrailingDays)
  const unproven = policy.floorShareOfUnprovenVolume > 0 ? unprovenVolume(orders, day, ctx) : 0
  const floor = Math.round(
    Math.max(policy.floorFixed, policy.floorShareOfTrailingVolume * trailing, policy.floorShareOfUnprovenVolume * unproven),
  )
  return { floor, trailing, unproven }
}

export function accountSnapshot(orders: OrderState[], day: Day, ctx: PricingContext): AccountSnapshot {
  const byType = zeroByType()
  let ordersHeld = 0
  let flatHeld = 0
  let heldOrderCount = 0
  for (const o of orders) {
    if (o.payment.capturedDay > day) continue
    const b = priceHoldback(o, day, ctx)
    ordersHeld += b.total
    flatHeld += flatHoldback(o.payment, day, ctx.policy)
    if (b.total > 0) heldOrderCount++
    for (const t of DISPUTE_TYPES) byType[t] += b.byType[t]
  }
  const { floor, trailing, unproven } = accountFloor(orders, day, ctx)
  const capped = ctx.policy.cap !== undefined ? Math.min(ordersHeld, ctx.policy.cap) : ordersHeld
  // Never below the floor, never above what the flat reserve would hold (a fixed bank-sponsor
  // minimum still wins over that cap).
  const held = Math.max(ctx.policy.floorFixed, Math.min(flatHeld, Math.max(floor, capped)))
  return {
    day,
    ordersHeld,
    floor,
    floorTopUp: Math.max(0, held - capped),
    held,
    unprovenVolume: unproven,
    flatHeld,
    heldOrderCount,
    byType,
    trailingVolume: trailing,
  }
}

export interface ReleaseDay {
  day: Day
  /** Thaw release on this day from payments already captured, if no new proof or dispute arrives. */
  total: number
  byType: Record<DisputeType, number>
  /** Release attributed to the account minimum stepping down (account-level projections only). */
  floor: number
  /** What the flat reserve releases on this day from the same payments. */
  flat: number
  orderIds: string[]
}

/**
 * Release calendar: for each future day, what comes back from payments already captured,
 * assuming no new proof and no disputes. That makes each date the latest expected release;
 * proof can only pull it earlier, and a dispute can only draw on it (PRD design principle:
 * show dates as ranges).
 */
export function projectReleases(orders: OrderState[], today: Day, ctx: PricingContext, horizonDays?: number): ReleaseDay[] {
  const horizon = horizonDays ?? ctx.policy.windowDays
  const days: ReleaseDay[] = []
  for (let i = 1; i <= horizon; i++) {
    days.push({ day: today + i, total: 0, byType: zeroByType(), floor: 0, flat: 0, orderIds: [] })
  }
  for (const order of orders) {
    if (order.payment.capturedDay > today) continue
    const known = knownAsOf(order, today)
    let prev = priceHoldback(known, today, ctx)
    let prevFlat = flatHoldback(order.payment, today, ctx.policy)
    if (prev.total === 0 && prevFlat === 0) continue
    for (let i = 1; i <= horizon; i++) {
      const cur = priceHoldback(known, today + i, ctx)
      const curFlat = flatHoldback(order.payment, today + i, ctx.policy)
      const slot = days[i - 1]
      const released = prev.total - cur.total
      if (released > 0) {
        slot.total += released
        slot.orderIds.push(order.payment.id)
        for (const t of DISPUTE_TYPES) slot.byType[t] += Math.max(0, prev.byType[t] - cur.byType[t])
      }
      slot.flat += Math.max(0, prevFlat - curFlat)
      prev = cur
      prevFlat = curFlat
      if (cur.total === 0 && curFlat === 0) break
    }
  }
  return days
}

/**
 * Release calendar for the account balance, not just order cover. When the account minimum
 * binds, order-level releases are absorbed by it and money comes back only as the minimum
 * steps down, so each day's net release is attributed to whichever is driving it:
 * - minimum binding today: the whole release is the minimum stepping down
 * - minimum stopped binding today: its old top-up, plus order releases by family
 * - minimum not binding: order releases by family
 */
export function projectAccountReleases(orders: OrderState[], today: Day, ctx: PricingContext, horizonDays?: number): ReleaseDay[] {
  const horizon = horizonDays ?? ctx.policy.windowDays
  const captured = orders.filter((o) => o.payment.capturedDay <= today)
  const orderLevel = projectReleases(captured, today, ctx, horizon)
  const series = accountSeries(captured, today, ctx, today, today + horizon)
  const out: ReleaseDay[] = []
  for (let i = 1; i <= horizon; i++) {
    const prev = series[i - 1]
    const cur = series[i]
    const o = orderLevel[i - 1]
    const topPrev = prev.thaw - prev.orders
    const topCur = cur.thaw - cur.orders
    const net = Math.max(0, prev.thaw - cur.thaw)
    const day: ReleaseDay = { day: o.day, total: net, byType: zeroByType(), floor: 0, flat: o.flat, orderIds: o.orderIds }
    if (topCur > 0) {
      day.floor = net
    } else {
      day.floor = Math.max(0, topPrev)
      const orderPart = Math.max(0, net - day.floor)
      const sum = DISPUTE_TYPES.reduce((acc, t) => acc + o.byType[t], 0)
      for (const t of DISPUTE_TYPES) day.byType[t] = sum > 0 ? (o.byType[t] / sum) * orderPart : 0
    }
    out.push(day)
  }
  return out
}

/** Proof kinds that would lower this order's holdback but have not arrived (verified) yet. */
export function missingProofs(order: OrderState, day: Day, ctx: PricingContext): ProofKind[] {
  const missing: ProofKind[] = []
  const known = knownAsOf(order, day)
  for (const t of DISPUTE_TYPES) {
    const kind = ctx.model.types[t].defusedBy[order.payment.fulfillment]
    if (!kind || kind === 'authentication' || kind === 'refund' || missing.includes(kind)) continue
    const verified = known.proofs.some(
      (p) => p.kind === kind && ctx.model.tierWeight[tierOf(p.source)][kind] >= 1,
    )
    if (!verified) missing.push(kind)
  }
  return missing
}

/** What a verified proof of `kind` arriving on `day` would release from this order right away. */
export function unlockIfProven(order: OrderState, kind: ProofKind, day: Day, ctx: PricingContext): Cents {
  const known = knownAsOf(order, day)
  const now = priceHoldback(known, day, ctx).total
  return Math.max(0, now - priceHoldback(withHypotheticalProof(known, kind, day), day, ctx).total)
}

export interface SpeedUpAction {
  kind: ProofKind
  title: string
  orderIds: string[]
  /** Order cover released right away if every proof in the group arrives verified today. */
  unlockNow: Cents
  /** Change in the account balance, which also counts the account minimum stepping down. */
  accountUnlockNow: Cents
}

/** Something the merchant can do: proof that is missing and not already on its way. */
function actionableMissing(order: OrderState, day: Day, ctx: PricingContext): ProofKind[] {
  const known = knownAsOf(order, day)
  return missingProofs(order, day, ctx).filter(
    // Tracking already sent: nothing to do but wait for the carrier.
    (kind) => !(kind === 'delivery' && known.proofs.some((p) => p.kind === 'delivery')),
  )
}

/**
 * PRD 3.3: actions ranked by dollars unlocked. Orders younger than `minAgeDays` are left out:
 * they may not have shipped yet, so there is nothing to add.
 */
export function speedUpList(orders: OrderState[], today: Day, ctx: PricingContext, minAgeDays = 3): SpeedUpAction[] {
  const groups = new Map<ProofKind, SpeedUpAction>()
  const visible = orders.filter((o) => o.payment.capturedDay <= today)
  for (const order of visible) {
    if (order.payment.radarFlag || today - order.payment.capturedDay < minAgeDays) continue
    for (const kind of actionableMissing(order, today, ctx)) {
      const unlock = unlockIfProven(order, kind, today, ctx)
      if (unlock <= 0) continue
      const g = groups.get(kind) ?? {
        kind,
        title: kind === 'delivery' ? 'Add tracking numbers' : 'Send usage events',
        orderIds: [],
        unlockNow: 0,
        accountUnlockNow: 0,
      }
      g.orderIds.push(order.payment.id)
      g.unlockNow += unlock
      groups.set(kind, g)
    }
  }
  const before = accountSnapshot(visible, today, ctx).held
  for (const g of groups.values()) {
    const ids = new Set(g.orderIds)
    const withProof = visible.map((o) => (ids.has(o.payment.id) ? withHypotheticalProof(o, g.kind, today) : o))
    g.accountUnlockNow = Math.max(0, before - accountSnapshot(withProof, today, ctx).held)
  }
  return [...groups.values()].sort((a, b) => b.accountUnlockNow - a.accountUnlockNow)
}

export function withHypotheticalProof(order: OrderState, kind: ProofKind, day: Day): OrderState {
  const source = kind === 'delivery' ? 'carrier' : kind === 'usage' ? 'billing_meter' : kind === 'authentication' ? 'stripe_3ds' : 'stripe_refunds'
  return { ...order, proofs: [...order.proofs, { id: `hyp_${kind}_${order.payment.id}`, paymentId: order.payment.id, kind, source, day }] }
}

/**
 * Counterfactual for the 3D Secure nudge: how much less would be held today if the
 * unauthenticated payments still in the window had been authenticated.
 */
export function authenticationUpside(orders: OrderState[], today: Day, ctx: PricingContext): { orders: number; lessHeld: Cents } {
  let count = 0
  let lessHeld = 0
  for (const order of orders) {
    if (order.payment.capturedDay > today) continue
    const known = knownAsOf(order, today)
    if (known.proofs.some((p) => p.kind === 'authentication')) continue
    const now = priceHoldback(known, today, ctx).total
    if (now === 0) continue
    const authed: OrderState = {
      ...known,
      proofs: [
        ...known.proofs,
        { id: 'hyp_auth', paymentId: order.payment.id, kind: 'authentication', source: 'stripe_3ds', day: order.payment.capturedDay },
      ],
    }
    const diff = now - priceHoldback(authed, today, ctx).total
    if (diff > 0) {
      count++
      lessHeld += diff
    }
  }
  return { orders: count, lessHeld }
}
