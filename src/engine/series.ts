/**
 * Account balance over time: history up to `today` and a projection after it, for the Thaw
 * Meter's held-balance chart. Uses the fast path, so it is cheap enough to recompute on every
 * time-travel step.
 *
 * Events after `today` are hidden, so the projection assumes no new proof and no disputes:
 * the same "latest expected release" convention as the release calendar.
 */

import { knownAsOf } from './account'
import { curveTables, unitHoldbackPath } from './fastpath'
import { verifiedFulfillmentDay, type PricingContext } from './holdback'
import type { Cents, Day, OrderState } from './types'

export interface SeriesPoint {
  day: Day
  /** Order-level Thaw holdbacks. */
  orders: Cents
  /** Total Thaw holds: orders, raised to the floor, capped at the flat reserve. */
  thaw: Cents
  /** What today's flat reserve holds. */
  flat: Cents
  floor: Cents
}

export function accountSeries(orders: OrderState[], today: Day, ctx: PricingContext, fromDay: Day, toDay: Day): SeriesPoint[] {
  const { policy, model } = ctx
  const W = policy.windowDays
  const n = toDay - fromDay + 1
  const thawUnits = new Float64Array(n)
  const flat = new Float64Array(n)
  const volume = new Float64Array(n + policy.floorTrailingDays)
  const unproven = new Float64Array(n)
  const tables = curveTables(model, W)
  const buf = new Float64Array(W)

  for (const order of orders) {
    const c = order.payment.capturedDay
    if (c > today || c > toDay || c + W < fromDay) continue
    const known = knownAsOf(order, today)
    unitHoldbackPath(known, model, policy, tables, buf)
    const proven = verifiedFulfillmentDay(known, model) ?? Infinity
    const flatAmount = Math.round(order.payment.amount * policy.rate)
    for (let a = 0; a < W; a++) {
      const i = c + a - fromDay
      if (i < 0) continue
      if (i >= n) break
      thawUnits[i] += buf[a]
      flat[i] += flatAmount
      if (a < policy.floorTrailingDays && c + a < proven) unproven[i] += order.payment.amount
    }
    const vi = c - fromDay + policy.floorTrailingDays
    if (vi >= 0 && vi < volume.length) volume[vi] += order.payment.amount
  }

  const points: SeriesPoint[] = []
  let trailing = 0
  for (let i = 0; i < policy.floorTrailingDays; i++) trailing += volume[i]
  for (let i = 0; i < n; i++) {
    // trailing = volume captured in (day - floorTrailingDays, day]
    trailing += volume[i + policy.floorTrailingDays] - volume[i]
    const ordersHeld = Math.round(thawUnits[i] * policy.rate)
    const floor = Math.round(
      Math.max(policy.floorFixed, policy.floorShareOfTrailingVolume * trailing, policy.floorShareOfUnprovenVolume * unproven[i]),
    )
    const capped = policy.cap !== undefined ? Math.min(ordersHeld, policy.cap) : ordersHeld
    const thaw = Math.max(policy.floorFixed, Math.min(flat[i], Math.max(floor, capped)))
    points.push({ day: fromDay + i, orders: ordersHeld, thaw, flat: flat[i], floor })
  }
  return points
}
