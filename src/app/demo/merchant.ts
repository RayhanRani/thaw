/**
 * The demo merchant: "Maya", the PRD's new online seller, running a fictional ceramics shop.
 * Every order, proof and dispute below is generated from a fixed seed. Nothing here is real
 * customer or Stripe data.
 *
 * Day numbers: day 0 is the shop's first day on the platform. The demo opens on DEMO_TODAY,
 * mapped to the PRD's date, and the time-travel control can move up to FUTURE_DAYS ahead;
 * orders and proofs after "today" are hidden from the engine until that day arrives.
 */

import {
  bernoulli,
  lognormal,
  mulberry32,
  pick,
  poisson,
  randInt,
  SimulatedCarrier,
  type Carrier,
  type Cents,
  type Day,
  type OrderState,
  type ProofEvent,
} from '../../engine'

export const SHOP_NAME = 'Clayhouse Studio'
export const OWNER = 'Maya'
export const DEMO_TODAY: Day = 150
export const FUTURE_DAYS = 60
/** Calendar date of day 0, chosen so DEMO_TODAY is Mon Oct 5, 2026. */
export const DAY0 = new Date(2026, 4, 8)

export interface DemoOrder extends OrderState {
  meta: {
    description: string
    customer: string
    carrier: Carrier
    trackingNumber: string
    shippedDay: Day | null
    deliveredDay: Day | null
    /** Whether the shop's tooling sent tracking to Stripe on its own. */
    trackingSentAutomatically: boolean
  }
}

const PRODUCTS: [string, number][] = [
  ['Speckled mug', 34_00],
  ['Ash-glaze bowl set', 86_00],
  ['Bud vase', 28_00],
  ['Serving platter', 118_00],
  ['Pour-over set', 72_00],
  ['Tea bowl pair', 54_00],
  ['Large planter', 96_00],
  ['Dinner plates, set of 4', 142_00],
  ['Salt cellar', 22_00],
  ['Ramen bowl', 46_00],
]

const LAST_NAMES = ['Alvarez', 'Okafor', 'Nguyen', 'Schmidt', 'Haddad', 'Kowalski', 'Tanaka', 'Moreau', 'Silva', 'Brennan', 'Patel', 'Lindqvist', 'Mensah', 'Rossi', 'Kim', 'Novak']
const INITIALS = 'ABCDEFGHJKLMNPRSTW'

function trackingFor(carrier: Carrier, rand: () => number): string {
  const digits = (n: number) => Array.from({ length: n }, () => Math.floor(rand() * 10)).join('')
  switch (carrier) {
    case 'usps':
      return `9400${digits(18)}`
    case 'ups': {
      const alnum = '0123456789ABCDEFGHJKLMNPRSTUVWXYZ'
      return `1Z${Array.from({ length: 16 }, () => alnum[Math.floor(rand() * alnum.length)]).join('')}`
    }
    case 'fedex':
      return digits(12)
    case 'dhl':
      return digits(10)
  }
}

export interface DemoWorld {
  orders: DemoOrder[]
  carrier: SimulatedCarrier
}

export function buildDemoWorld(seed = 4102026): DemoWorld {
  const rand = mulberry32(seed)
  const carrier = new SimulatedCarrier()
  const orders: DemoOrder[] = []
  let verified = 0
  let seq = 1040

  for (let d = 0; d <= DEMO_TODAY + FUTURE_DAYS; d++) {
    // A growing shop: about 2 orders a day at launch, 12 by the demo date.
    const growth = Math.min(1, d / 130)
    const weekday = (DAY0.getDay() + d) % 7
    const weekendLift = weekday === 0 || weekday === 6 ? 1.25 : 1
    const n = poisson(rand, (2 + 10 * growth) * weekendLift)

    for (let j = 0; j < n; j++) {
      const [product, price] = pick(rand, PRODUCTS)
      const qty = bernoulli(rand, 0.2) ? 2 : 1
      const amount: Cents = Math.round((price * qty + (bernoulli(rand, 0.6) ? 8_00 : 0)) * (lognormal(rand, 1, 0.05)) / 100) * 100
      const id = `py_${(++seq).toString(36).toUpperCase()}${Math.floor(rand() * 1e6).toString(36).toUpperCase()}`
      const customer = `${INITIALS[Math.floor(rand() * INITIALS.length)]}. ${pick(rand, LAST_NAMES)}`
      const seasoning = Math.min(1, 0.5 + (0.5 * verified) / 100)

      const proofs: ProofEvent[] = []
      if (bernoulli(rand, 0.62)) proofs.push({ id: `${id}_3ds`, paymentId: id, kind: 'authentication', source: 'stripe_3ds', day: d, detail: '3D Secure authenticated' })

      const c: Carrier = bernoulli(rand, 0.7) ? 'usps' : 'ups'
      const tracking = trackingFor(c, rand)
      const shippedDay = d + randInt(rand, 0, 2)
      const lost = bernoulli(rand, 0.01)
      const deliveredDay = lost ? null : shippedDay + 2 + poisson(rand, 1.8)
      carrier.register(c, tracking, shippedDay, deliveredDay)

      const auto = bernoulli(rand, 0.76)
      if (auto) {
        proofs.push({ id: `${id}_shp`, paymentId: id, kind: 'delivery', source: 'merchant_api', day: shippedDay, detail: `${c.toUpperCase()} ${tracking} in transit` })
        if (deliveredDay !== null) {
          proofs.push({ id: `${id}_dlv`, paymentId: id, kind: 'delivery', source: 'carrier', day: deliveredDay, detail: `${c.toUpperCase()} ${tracking} delivered` })
          verified++
        }
      }
      if (bernoulli(rand, 0.02)) {
        const partial = bernoulli(rand, 0.5)
        proofs.push({
          id: `${id}_rf`,
          paymentId: id,
          kind: 'refund',
          source: 'stripe_refunds',
          day: d + randInt(rand, 3, 20),
          amount: partial ? Math.round(amount * 0.3) : amount,
          detail: partial ? 'Partial refund (chipped glaze)' : 'Refunded in full',
        })
      }

      orders.push({
        payment: {
          id,
          merchantId: 'acct_clayhouse',
          amount,
          capturedDay: d,
          fulfillment: 'physical',
          description: qty > 1 ? `${product} ×${qty}` : product,
          customer,
          seasoning,
        },
        proofs,
        adverse: [],
        meta: {
          description: product,
          customer,
          carrier: c,
          trackingNumber: tracking,
          shippedDay,
          deliveredDay,
          trackingSentAutomatically: auto,
        },
      })
    }
  }

  scriptEvents(orders)
  return { orders, carrier }
}

/** Hand-placed events so every reason code shows up somewhere in the demo. */
function scriptEvents(orders: DemoOrder[]): void {
  const find = (fromDay: Day, test: (o: DemoOrder) => boolean) =>
    orders.find((o) => o.payment.capturedDay >= fromDay && test(o) && o.adverse.length === 0 && !o.payment.radarFlag)
  const unauth = (o: DemoOrder) => !o.proofs.some((p) => p.kind === 'authentication')
  const untracked = (o: DemoOrder) => !o.meta.trackingSentAutomatically

  // An older fraud dispute on an unauthenticated payment.
  const fraud = find(70, unauth)
  if (fraud) fraud.adverse.push({ kind: 'dispute', paymentId: fraud.payment.id, day: 104, disputeType: 'fraud', amount: fraud.payment.amount })

  // A "not received" dispute on an order that never had tracking sent.
  const nr = find(118, untracked)
  if (nr) nr.adverse.push({ kind: 'dispute', paymentId: nr.payment.id, day: 141, disputeType: 'not_received', amount: nr.payment.amount })

  // An early fraud warning raises fraud cover on a recent unauthenticated payment.
  const efw = find(136, (o) => unauth(o) && o.payment.amount > 60_00)
  if (efw) efw.adverse.push({ kind: 'early_fraud_warning', paymentId: efw.payment.id, day: 146 })

  // Radar blocks early release on one large order.
  const radar = find(145, (o) => o.payment.amount > 100_00)
  if (radar) radar.payment.radarFlag = 'address_mismatch'

  // A future dispute, so time travel shows a holdback being raised again.
  const later = find(152, unauth)
  if (later) later.adverse.push({ kind: 'dispute', paymentId: later.payment.id, day: 171, disputeType: 'fraud', amount: later.payment.amount })
}

export function dayToDate(day: Day): Date {
  const d = new Date(DAY0)
  d.setDate(d.getDate() + day)
  return d
}

export function dateToDay(date: Date): Day {
  return Math.round((date.getTime() - DAY0.getTime()) / 86_400_000)
}
