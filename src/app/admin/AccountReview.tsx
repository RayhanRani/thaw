import { useMemo, useState } from 'react'
import { orderTimeline, reasonCopy, verifiedFulfillmentDay } from '../../engine'
import { OWNER, SHOP_NAME } from '../demo/merchant'
import { dayLabel, money, pct, plural } from '../lib/format'
import { PageHeader } from '../shell/AppShell'
import { useDemo } from '../state/demo'
import { Badge, Button, Callout, Card, CardHeader, Segmented, Slider } from '../ui'
import { AnimatedNumber, ThawBar, useToast } from '../ui/motion'

/** Stripe-side account review: the same numbers the merchant sees, plus the levers Risk owns. */
export function AccountReview() {
  const { snapshot, today, disputeSignal, killSwitchOn, visible, ctx } = useDemo()
  const coverage = useMemo(() => {
    const recent = visible.filter((o) => today - o.payment.capturedDay >= 7 && today - o.payment.capturedDay < 37)
    const proven = recent.filter((o) => {
      const d = verifiedFulfillmentDay(o, ctx.model)
      return d !== null && d <= today
    })
    return recent.length ? proven.length / recent.length : 0
  }, [visible, today, ctx])
  const spike = disputeSignal.baselineRate > 0 && disputeSignal.recentRate > 2 * disputeSignal.baselineRate

  return (
    <>
      <PageHeader
        eyebrow="Account review"
        title={SHOP_NAME}
        subtitle="Changes here apply to the merchant view immediately. Try the kill switch, then switch to the merchant view."
        action={
          killSwitchOn ? (
            <Badge tone="critical" dot>
              Kill switch on · standard schedule
            </Badge>
          ) : (
            <Badge tone="good" dot>
              On Thaw · model {ctx.model.version}
            </Badge>
          )
        }
      />
      <div className="space-y-5">
        <section className="card overflow-hidden">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line px-5 py-3 text-[13px] text-ink-2">
            <span className="font-mono text-xs text-muted">acct_clayhouse</span>
            <span>Physical goods · ceramics</span>
            <span>On the platform {today} days</span>
            <span>Owner: {OWNER}</span>
          </div>
          <div className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-4">
            <Tile label="Held now" value={<AnimatedNumber value={snapshot.held} format={(v) => money(v)} />} sub={`Standard reserve: ${money(snapshot.flatHeld)}`} />
            <Tile label="Account floor" value={money(snapshot.floor)} sub={`${pct(ctx.policy.floorShareOfUnprovenVolume)} of ${money(snapshot.unprovenVolume)} unproven`} />
            <Tile label="Delivery proof coverage" value={pct(coverage)} sub="Orders 7 to 36 days old" />
            <Tile
              label="Dispute rate, 30 days"
              value={pct(disputeSignal.recentRate, 2)}
              sub={`Prior 90 days: ${pct(disputeSignal.baselineRate, 2)}`}
              alert={spike}
            />
          </div>
          <div className="px-5 py-4">
            <ThawBar held={snapshot.held} total={snapshot.flatHeld} heldLabel={`Thaw holds ${money(snapshot.held)}`} thawedLabel={`Released early ${money(Math.max(0, snapshot.flatHeld - snapshot.held))}`} />
          </div>
        </section>
        <div className="grid gap-5 lg:grid-cols-2">
          <PolicyCard />
          <SupportSummary coverage={coverage} />
        </div>
        <DecisionLog />
      </div>
    </>
  )
}

function Tile({ label, value, sub, alert }: { label: string; value: React.ReactNode; sub: string; alert?: boolean }) {
  return (
    <div className="bg-surface px-5 py-4">
      <div className="text-[13px] text-ink-2">{label}</div>
      <div className={alert ? 'mt-0.5 text-2xl font-semibold text-critical' : 'mt-0.5 text-2xl font-semibold'}>{value}</div>
      <div className="text-xs text-muted">{sub}</div>
    </div>
  )
}

function SupportSummary({ coverage }: { coverage: number }) {
  const { snapshot, policy, releases, speedUp, killSwitchOn, today } = useDemo()
  const next30 = releases.slice(0, 30).reduce((s, r) => s + r.total, 0)
  const unlock = speedUp.reduce((s, a) => s + a.accountUnlockNow, 0)
  const missing = speedUp.find((a) => a.kind === 'delivery')?.orderIds.length ?? 0
  return (
    <Card>
      <CardHeader title={'Answer "why is my money held?"'} subtitle="Written from the Meter data, for a support agent to send or adapt" />
      <div className="rounded-lg border border-line bg-surface-2 p-3.5 text-[13px] leading-relaxed">
        Hi {OWNER}, as of {dayLabel(today)} we're holding {money(snapshot.held)} from your recent orders to cover disputes that can still arrive.{' '}
        {killSwitchOn ? (
          <>Your account is on the standard schedule while our Risk team reviews it, so each order's reserve releases {policy.windowDays} days after the payment.</>
        ) : (
          <>
            That's {money(snapshot.flatHeld - snapshot.held)} less than your standard {pct(policy.rate)} reserve, because orders with 3D Secure and confirmed delivery release early.{' '}
            {money(next30)} is scheduled to come back over the next 30 days.{' '}
            {missing > 0 && (
              <>
                {plural(missing, 'order')} {missing === 1 ? 'is' : 'are'} missing tracking. Adding {missing === 1 ? 'it' : 'them'} would release up to {money(unlock)} once the carrier
                confirms delivery.{' '}
              </>
            )}
          </>
        )}
        You can see every held order, its reason and its release date in the Thaw Meter, and you can contest any hold there; we answer in writing within 3 business days.
      </div>
      <p className="mt-2 text-xs text-muted">Recent delivery proof coverage: {pct(coverage)}.</p>
    </Card>
  )
}

function PolicyCard() {
  const { policy, setPolicy, killSwitchOn, setKillSwitch, modelId, setModelId } = useDemo()
  const [confirm, setConfirm] = useState(false)
  const toast = useToast()
  return (
    <Card>
      <CardHeader title="Policy" subtitle="Risk-set inputs. Thaw can never release below the floor or hold more than the flat reserve." />
      <div className="space-y-4">
        <Slider label="Reserve rate at payment" value={policy.rate} min={0.05} max={0.25} step={0.01} onChange={(rate) => setPolicy({ rate })} format={(v) => pct(v)} />
        <Slider label="Reserve window" value={policy.windowDays} min={60} max={180} step={10} onChange={(windowDays) => setPolicy({ windowDays })} format={(v) => `${v} days`} />
        <Slider
          label="Floor: share of recent orders without verified delivery"
          value={policy.floorShareOfUnprovenVolume}
          min={0}
          max={1}
          step={0.05}
          onChange={(floorShareOfUnprovenVolume) => setPolicy({ floorShareOfUnprovenVolume })}
          format={(v) => pct(v)}
          hint="The backtest's pilot setting is 30%."
        />
        <Slider
          label="Fixed minimum (for example a bank-sponsor requirement)"
          value={policy.floorFixed}
          min={0}
          max={10_000_00}
          step={250_00}
          onChange={(floorFixed) => setPolicy({ floorFixed })}
          format={(v) => money(v)}
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Segmented
            label="Model version"
            value={modelId}
            onChange={setModelId}
            options={[
              { value: 'pilot', label: 'thaw-0.1.0' },
              { value: 'toy', label: 'toy-2026-10-04' },
            ]}
          />
          {killSwitchOn ? (
            <Button onClick={() => setKillSwitch(false)}>Return to Thaw</Button>
          ) : !confirm ? (
            <Button variant="danger" onClick={() => setConfirm(true)}>
              Kill switch
            </Button>
          ) : (
            <span className="flex items-center gap-2">
              <Button
                variant="danger"
                onClick={() => {
                  setKillSwitch(true)
                  setConfirm(false)
                  toast({ title: 'Kill switch on', body: 'Every order is back on the standard reserve schedule.', tone: 'warn' })
                }}
              >
                Move to standard schedule
              </Button>
              <Button variant="ghost" onClick={() => setConfirm(false)}>
                Cancel
              </Button>
            </span>
          )}
        </div>
        {killSwitchOn && (
          <Callout tone="warn">
            Every order is back on the flat schedule. The increase is withheld from upcoming payouts, and the merchant sees the reason code "Standard schedule".
          </Callout>
        )}
      </div>
    </Card>
  )
}

/** Auditability: every holdback change with its reason and model version, newest first. */
function DecisionLog() {
  const { visible, today, ctx, byId } = useDemo()
  const [days, setDays] = useState<'3' | '7' | '14'>('7')
  const entries = useMemo(() => {
    const since = today - Number(days)
    const out: { day: number; paymentId: string; from: number; to: number; reason: string; detail: string; version: string }[] = []
    for (const o of visible) {
      if (o.payment.capturedDay < since - ctx.policy.windowDays) continue
      for (const e of orderTimeline(o, today, ctx)) {
        if (e.kind === 'decay' || e.kind === 'capture' || e.day <= since) continue
        out.push({ day: e.day, paymentId: o.payment.id, from: e.from, to: e.to, reason: reasonCopy(e.reason).title, detail: e.detail, version: e.modelVersion })
      }
    }
    return out.sort((a, b) => b.day - a.day || Math.abs(b.to - b.from) - Math.abs(a.to - a.from))
  }, [visible, today, ctx, days])
  return (
    <Card>
      <CardHeader
        title="Decision log"
        subtitle="Every holdback change triggered by proof, a dispute, a fraud signal or policy, with its reason and model version."
        action={
          <Segmented
            label="Period"
            value={days}
            onChange={setDays}
            options={[
              { value: '3', label: '3 days' },
              { value: '7', label: '7 days' },
              { value: '14', label: '14 days' },
            ]}
          />
        }
      />
      <div className="max-h-[420px] overflow-auto">
        <table className="w-full min-w-[720px] text-[13px]">
          <thead className="sticky top-0 bg-surface">
            <tr className="border-b border-line text-left text-xs text-muted">
              <th className="py-1.5 font-medium">Day</th>
              <th className="py-1.5 font-medium">Payment</th>
              <th className="py-1.5 font-medium">Change</th>
              <th className="py-1.5 font-medium">Reason</th>
              <th className="py-1.5 font-medium">Model</th>
            </tr>
          </thead>
          <tbody>
            {entries.slice(0, 200).map((e, i) => (
              <tr key={i} className="border-b border-line last:border-0">
                <td className="py-1.5 whitespace-nowrap text-ink-2">{dayLabel(e.day)}</td>
                <td className="py-1.5">
                  <div>{byId.get(e.paymentId)?.payment.description}</div>
                  <div className="font-mono text-[11px] text-muted">{e.paymentId}</div>
                </td>
                <td className="tabular py-1.5 whitespace-nowrap">
                  {money(e.from, { cents: true })} → <span className={e.to > e.from ? 'font-medium text-critical' : 'font-medium'}>{money(e.to, { cents: true })}</span>
                </td>
                <td className="py-1.5">
                  <div>{e.reason}</div>
                  <div className="max-w-[360px] truncate text-xs text-muted">{e.detail}</div>
                </td>
                <td className="py-1.5 font-mono text-xs text-muted">{e.version}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {entries.length === 0 && <p className="py-4 text-center text-[13px] text-ink-2">No changes in this period.</p>}
      </div>
    </Card>
  )
}
