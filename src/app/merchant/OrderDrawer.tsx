import { useMemo, useState } from 'react'
import {
  AppealError,
  knownAsOf,
  missingProofs,
  orderTimeline,
  priceHoldback,
  reasonCopy,
  tierOf,
  unlockIfProven,
  webhookEvents,
  withHypotheticalProof,
  type ProofEvent,
} from '../../engine'
import { LineChart } from '../charts/LineChart'
import type { DemoOrder } from '../demo/merchant'
import { dateLabel, dayLabel, dayLong, money } from '../lib/format'
import { useDemo } from '../state/demo'
import { Badge, Button, Callout, Drawer } from '../ui'
import { FAMILY_COLOR, FAMILY_ORDER, priceNow, StatusBadge } from './shared'

const TIER_LABEL = { verified: 'Verified', trusted_partner: 'Trusted partner', merchant_asserted: 'Merchant-reported' } as const

export function OrderDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { byId } = useDemo()
  const order = id ? byId.get(id) : undefined
  return (
    <Drawer open={!!order} onClose={onClose} title={order ? `${order.payment.description} · ${money(order.payment.amount, { cents: true })}` : ''} width={620}>
      {order && <OrderDetail order={order} key={order.payment.id} />}
    </Drawer>
  )
}

function OrderDetail({ order }: { order: DemoOrder }) {
  const { today, ctx, addTracking, killSwitchOn } = useDemo()
  const b = priceNow(order, today, ctx)
  const known = knownAsOf(order, today)
  const W = ctx.policy.windowDays
  const capture = order.payment.capturedDay
  const missing = missingProofs(order, today, ctx)
  const hasTrackingEvent = known.proofs.some((p) => p.kind === 'delivery')
  const deliveryUnlock = missing.includes('delivery') ? unlockIfProven(order, 'delivery', today, ctx) : 0
  const [msg, setMsg] = useState<string | null>(null)

  const path = useMemo(() => {
    const xs: number[] = []
    const thaw: number[] = []
    const flat: number[] = []
    const ifProof: (number | null)[] = []
    const hyp = missing.includes('delivery') ? withHypotheticalProof(known, 'delivery', today) : null
    for (let d = capture; d <= capture + W; d++) {
      xs.push(d)
      const cur = priceHoldback(known, d, ctx)
      thaw.push(cur.total)
      flat.push(cur.flat)
      ifProof.push(hyp && d >= today ? priceHoldback(hyp, d, ctx).total : null)
    }
    return { xs, thaw, flat, ifProof }
  }, [known, ctx, capture, W, today, missing])

  const timeline = useMemo(() => orderTimeline(order, today, ctx), [order, today, ctx])
  const hooks = useMemo(() => webhookEvents(order, today, ctx), [order, today, ctx])
  const familyRows = FAMILY_ORDER.map((t) => ({ t, label: ctx.model.types[t].label, value: b.byType[t] }))

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[13px] text-ink-2">Held now</div>
          <div className="text-3xl font-semibold tracking-tight">{money(b.total, { cents: true })}</div>
          <div className="text-[13px] text-ink-2">Standard reserve would hold {money(b.flat, { cents: true })}</div>
        </div>
        <div className="text-right text-[13px] text-ink-2">
          <StatusBadge b={b} ageDays={today - capture} />
          <div className="mt-1">
            Paid {dayLong(capture)} · {order.payment.customer}
          </div>
          <div className="font-mono text-[11px] text-muted">{order.payment.id}</div>
        </div>
      </div>

      <section>
        <h3 className="mb-2 text-[13px] font-semibold">Release range</h3>
        <p className="mb-2 text-[13px] text-ink-2">
          {b.total === 0 ? (
            'Nothing is held on this order.'
          ) : (
            <>
              Released in full by <span className="font-medium text-ink">{dayLabel(capture + W)}</span> at the latest.{' '}
              {deliveryUnlock > 0 && !killSwitchOn && (
                <>
                  If the carrier confirms delivery today, <span className="font-medium text-good-ink">{money(deliveryUnlock, { cents: true })}</span> releases now.
                </>
              )}{' '}
              A dispute could still draw on what is held.
            </>
          )}
        </p>
        <LineChart
          ariaLabel="This order's holdback over its reserve window"
          height={170}
          xs={path.xs}
          xTickCount={4}
          series={[
            { key: 'flat', label: 'Standard reserve', color: 'var(--flat)', values: path.flat },
            { key: 'thaw', label: 'Thaw, current proof', color: 'var(--s1)', values: path.thaw },
            ...(path.ifProof.some((v) => v !== null) ? [{ key: 'if', label: 'If delivery is confirmed today', color: 'var(--s3)', values: path.ifProof }] : []),
          ]}
          xFormat={dayLabel}
          tooltipTitle={dayLong}
          yFormat={(v) => money(v, { cents: true })}
          marker={{ x: today, label: 'Today' }}
          shadeFrom={today}
        />
      </section>

      <section>
        <h3 className="mb-2 text-[13px] font-semibold">Why it's held</h3>
        <ul className="divide-y divide-line rounded-lg border border-line text-[13px]">
          {familyRows.map((r) => (
            <li key={r.t} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="inline-flex items-center gap-2">
                <span className="size-2.5 rounded-[3px]" style={{ background: FAMILY_COLOR[r.t] }} />
                {r.label}
              </span>
              <span className="tabular font-medium">{money(r.value, { cents: true })}</span>
            </li>
          ))}
        </ul>
        <ul className="mt-3 space-y-2">
          {b.reasons
            .filter((r) => r !== 'TIME_DECAY' || b.reasons.length === 1)
            .map((r) => (
              <li key={r} className="text-[13px]">
                <span className="font-medium">{reasonCopy(r).title}.</span> <span className="text-ink-2">{reasonCopy(r).body}</span>
              </li>
            ))}
        </ul>
      </section>

      <section>
        <h3 className="mb-2 text-[13px] font-semibold">Proof</h3>
        <ul className="space-y-1.5 text-[13px]">
          {known.proofs.length === 0 && <li className="text-ink-2">No proof received yet.</li>}
          {known.proofs.map((p: ProofEvent) => (
            <li key={p.id} className="flex flex-wrap items-center gap-2">
              <Badge tone={tierOf(p.source) === 'verified' ? 'good' : tierOf(p.source) === 'trusted_partner' ? 'accent' : 'neutral'}>{TIER_LABEL[tierOf(p.source)]}</Badge>
              <span>{p.detail ?? p.kind}</span>
              <span className="text-muted">{dayLabel(p.day)}</span>
            </li>
          ))}
          {missing.map((k) => (
            <li key={k} className="flex flex-wrap items-center gap-2">
              <Badge tone="warn">Missing</Badge>
              <span>{k === 'delivery' ? (hasTrackingEvent ? 'Carrier confirmation of delivery' : 'Tracking number') : 'Usage events'}</span>
            </li>
          ))}
        </ul>
        {missing.includes('delivery') && !hasTrackingEvent && (
          <div className="mt-3 rounded-lg border border-line p-3">
            <div className="text-[13px]">
              Add tracking: <span className="font-mono">{order.meta.carrier.toUpperCase()} {order.meta.trackingNumber}</span>
              <div className="text-xs text-muted">Pre-filled from the shop's label history in this demo.</div>
            </div>
            <Button
              size="sm"
              variant="primary"
              className="mt-2"
              onClick={() => {
                const r = addTracking([order.payment.id])
                setMsg(r.messages[0] ?? null)
              }}
            >
              Send to carrier for confirmation
            </Button>
          </div>
        )}
        {msg && (
          <div className="mt-2">
            <Callout tone="accent">{msg}</Callout>
          </div>
        )}
      </section>

      <AppealForm order={order} heldNow={b.total} reason={b.reasons[0]} />

      <section>
        <h3 className="mb-2 text-[13px] font-semibold">History</h3>
        <ol className="relative space-y-3 border-l border-line pl-4">
          {timeline.map((e, i) => (
            <li key={i} className="text-[13px]">
              <span className="absolute -left-[5px] mt-1.5 size-2.5 rounded-full border-2 border-surface" style={{ background: e.to < e.from ? 'var(--good)' : e.to > e.from ? 'var(--critical)' : 'var(--muted)' }} />
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{reasonCopy(e.reason).title}</span>
                <span className="tabular text-ink-2">
                  {money(e.from, { cents: true })} → <span className="font-medium text-ink">{money(e.to, { cents: true })}</span>
                </span>
              </div>
              <div className="text-ink-2">{e.detail}</div>
              <div className="text-xs text-muted">
                {e.toDay !== undefined && e.toDay !== e.day ? `${dayLabel(e.day)} to ${dayLabel(e.toDay)}` : dayLabel(e.day)} · model {e.modelVersion}
              </div>
            </li>
          ))}
        </ol>
      </section>

      <details className="rounded-lg border border-line p-3 text-[13px]">
        <summary className="cursor-pointer font-medium">Developer view: webhook events</summary>
        <pre className="mt-2 max-h-64 overflow-auto rounded bg-surface-2 p-2 font-mono text-[11px] leading-relaxed">{JSON.stringify(hooks, null, 2)}</pre>
      </details>
    </div>
  )
}

function AppealForm({ order, heldNow, reason }: { order: DemoOrder; heldNow: number; reason?: Parameters<typeof reasonCopy>[0] }) {
  const { submitAppeal, appeals } = useDemo()
  const [open, setOpen] = useState(false)
  const [statement, setStatement] = useState('')
  const [files, setFiles] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const existing = appeals.find((a) => a.paymentId === order.payment.id)
  if (heldNow === 0 && !existing) return null
  const code = reason ?? 'HELD_AT_CAPTURE'

  if (existing) {
    return (
      <Callout tone={existing.status === 'decided' ? 'good' : 'accent'} title={`Appeal ${existing.id}`}>
        {existing.status === 'decided' ? existing.decision!.explanation : `Written decision due by ${dateLabel(existing.dueBy)}.`}
      </Callout>
    )
  }
  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Contest this hold
      </Button>
    )
  }
  return (
    <form
      className="space-y-2.5 rounded-lg border border-line p-3.5"
      onSubmit={(e) => {
        e.preventDefault()
        try {
          submitAppeal({ paymentId: order.payment.id, reasonCode: code, amountAtIssue: heldNow, statement, evidence: files })
          setError(null)
        } catch (err) {
          setError(err instanceof AppealError ? err.message : String(err))
        }
      }}
    >
      <div className="text-[13px]">
        <div className="font-semibold">Contest: {reasonCopy(code).title}</div>
        <div className="text-ink-2">{reasonCopy(code).body}</div>
      </div>
      <label className="block text-[13px]">
        <span className="text-ink-2">Why should this change?</span>
        <textarea
          className="mt-1 w-full rounded-lg border border-line bg-surface p-2 text-[13px]"
          rows={3}
          value={statement}
          onChange={(e) => setStatement(e.target.value)}
          placeholder="For example: the shipping and billing addresses differ because this was a gift."
        />
      </label>
      <label className="block text-[13px]">
        <span className="text-ink-2">Evidence (optional)</span>
        <input type="file" multiple className="mt-1 block text-[13px]" onChange={(e) => setFiles([...(e.target.files ?? [])].map((f) => f.name))} />
      </label>
      {error && <div className="text-[13px] text-critical">{error}</div>}
      <div className="flex items-center gap-2">
        <Button type="submit" variant="primary">
          Submit appeal
        </Button>
        <span className="text-xs text-muted">You will get a written decision within 3 business days.</span>
      </div>
    </form>
  )
}
