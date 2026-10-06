import { CheckCircle2, Truck, Zap } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { money, plural } from '../lib/format'
import { HeldSummary } from '../shared/HeldSummary'
import { useDemo } from '../state/demo'
import { Button, Pane, SplitCard } from '../ui'
import { AnimatedNumber, useToast } from '../ui/motion'

/** The merchant's first card: the money on hold on the left, the one action that releases more on the right. */
export function BalanceHero() {
  return (
    <SplitCard>
      <HeldSummary label="Money on hold" backText="is already back with you" switchedText="Stripe’s risk team moved this store back to today’s reserve" />
      <TrackingPane />
    </SplitCard>
  )
}

interface Done {
  orders: number
  verified: number
  pending: number
  released: number
}

function TrackingPane() {
  const { snapshot, speedUp, killSwitchOn, addTracking } = useDemo()
  const toast = useToast()
  const before = useRef<number | null>(null)
  const [done, setDone] = useState<Done | null>(null)
  const tracking = speedUp.find((a) => a.kind === 'delivery')

  // Once the new proof is priced in, report how much came back.
  useEffect(() => {
    if (before.current === null) return
    const released = Math.max(0, before.current - snapshot.held)
    before.current = null
    setDone((d) => (d ? { ...d, released } : d))
    if (released > 0) toast({ title: `${money(released)} is back in your balance`, body: 'The carrier confirmed those deliveries.', tone: 'good' })
  }, [snapshot.held, toast])

  const onAddTracking = () => {
    if (!tracking) return
    before.current = snapshot.held
    const r = addTracking(tracking.orderIds)
    setDone({ orders: tracking.orderIds.length, verified: r.verified, pending: r.pending, released: 0 })
  }

  return (
    <Pane label="Get money back sooner" icon={Zap} act>
      {killSwitchOn ? (
        <p className="t-body mt-5">While this store is on today’s reserve, proof doesn’t speed anything up.</p>
      ) : tracking ? (
        <>
          <div className="t-figure mt-5 !text-good-ink">
            +<AnimatedNumber value={tracking.accountUnlockNow} format={(v) => money(v)} />
          </div>
          <p className="t-body mt-3">
            {plural(tracking.orderIds.length, 'order')} shipped without a tracking number. Add it, and this comes back once the carrier confirms delivery.
          </p>
          <div className="mt-auto pt-8">
            <Button variant="primary" className="w-full" onClick={onAddTracking}>
              <Truck className="size-5" />
              Add tracking to {plural(tracking.orderIds.length, 'order')}
            </Button>
          </div>
        </>
      ) : done ? (
        <>
          <div className="t-figure mt-5 !text-good-ink">
            +<AnimatedNumber value={done.released} format={(v) => money(v)} />
          </div>
          <p className="t-body mt-3">
            came back. The carrier confirmed {plural(done.verified, 'delivery', 'deliveries')}
            {done.pending > 0 ? `; ${done.pending} ${done.pending === 1 ? 'order is' : 'orders are'} still on the way.` : '.'}
          </p>
          <div className="mt-auto flex items-center gap-2 pt-8 text-[15px] font-semibold text-good-ink">
            <CheckCircle2 className="size-5" /> Tracking added to {plural(done.orders, 'order')}
          </div>
        </>
      ) : (
        <p className="t-body mt-5">Every shipped order has tracking. Nothing to add right now.</p>
      )}
    </Pane>
  )
}
