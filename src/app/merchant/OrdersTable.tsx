import { useMemo, useState } from 'react'
import { reasonCopy, type HoldbackBreakdown } from '../../engine'
import type { DemoOrder } from '../demo/merchant'
import { dayLabel, money, plural } from '../lib/format'
import { useDemo } from '../state/demo'
import { Badge, Button, Card, CardHeader, Segmented } from '../ui'
import { priceNow, StatusBadge, statusOf } from './shared'

type Filter = 'held' | 'tracking' | 'transit' | 'flagged' | 'all'

/** Orders with their holdbacks; the entry point to the order drill-down (PRD 3.2). */
export function OrdersTable({ onOpen }: { onOpen: (id: string) => void }) {
  const { visible, today, ctx } = useDemo()
  const [filter, setFilter] = useState<Filter>('held')
  const [limit, setLimit] = useState(15)

  const rows = useMemo(() => {
    return visible
      .map((o) => ({ o, b: priceNow(o, today, ctx) }))
      .sort((a, b) => b.o.payment.capturedDay - a.o.payment.capturedDay || b.o.payment.amount - a.o.payment.amount)
  }, [visible, today, ctx])

  const filtered = rows.filter(({ o, b }) => {
    const s = statusOf(b, today - o.payment.capturedDay).label
    switch (filter) {
      case 'held':
        return b.total > 0
      case 'tracking':
        return s === 'Needs tracking'
      case 'transit':
        return s === 'In transit'
      case 'flagged':
        return ['Radar hold', 'Fraud warning', 'Disputed', 'Proof withdrawn'].includes(s)
      case 'all':
        return true
    }
  })

  return (
    <Card>
      <CardHeader
        title="Orders"
        subtitle="Held now against what today's standard reserve would hold"
        action={
          <Button size="sm" onClick={() => exportCsv(filtered, ctx.model.version, today)}>
            Export CSV
          </Button>
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Segmented<Filter>
          label="Filter orders"
          value={filter}
          onChange={(f) => {
            setFilter(f)
            setLimit(15)
          }}
          options={[
            { value: 'held', label: 'Held' },
            { value: 'tracking', label: 'Needs tracking' },
            { value: 'transit', label: 'In transit' },
            { value: 'flagged', label: 'Flagged' },
            { value: 'all', label: 'All' },
          ]}
        />
        <span className="ml-auto text-[13px] text-muted">{plural(filtered.length, 'order')}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-[13px]">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th className="py-2 pr-3 font-medium">Date</th>
              <th className="py-2 pr-3 font-medium">Order</th>
              <th className="py-2 pr-3 text-right font-medium">Amount</th>
              <th className="py-2 pr-3 text-right font-medium">Held now</th>
              <th className="py-2 pr-3 text-right font-medium">Standard reserve</th>
              <th className="py-2 pr-3 font-medium">Status</th>
              <th className="py-2 font-medium">Main reason</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, limit).map(({ o, b }) => (
              <tr
                key={o.payment.id}
                tabIndex={0}
                onClick={() => onOpen(o.payment.id)}
                onKeyDown={(e) => e.key === 'Enter' && onOpen(o.payment.id)}
                className="cursor-pointer border-b border-line last:border-0 hover:bg-surface-2"
              >
                <td className="py-2 pr-3 whitespace-nowrap text-ink-2">{dayLabel(o.payment.capturedDay)}</td>
                <td className="py-2 pr-3">
                  <div className="font-medium">{o.payment.description}</div>
                  <div className="font-mono text-[11px] text-muted">{o.payment.id}</div>
                </td>
                <td className="tabular py-2 pr-3 text-right">{money(o.payment.amount, { cents: true })}</td>
                <td className="tabular py-2 pr-3 text-right font-semibold">{money(b.total, { cents: true })}</td>
                <td className="tabular py-2 pr-3 text-right text-ink-2">{money(b.flat, { cents: true })}</td>
                <td className="py-2 pr-3">
                  <StatusBadge b={b} ageDays={today - o.payment.capturedDay} />
                </td>
                <td className="max-w-[220px] truncate py-2 text-ink-2">{b.reasons[0] ? reasonCopy(b.reasons[0]).title : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {filtered.length > limit && (
        <div className="mt-3 text-center">
          <Button size="sm" variant="ghost" onClick={() => setLimit((l) => l + 25)}>
            Show more
          </Button>
        </div>
      )}
      {filtered.length === 0 && (
        <div className="py-6 text-center text-[13px] text-ink-2">
          <Badge>Nothing here</Badge>
        </div>
      )}
    </Card>
  )
}

function exportCsv(rows: { o: DemoOrder; b: HoldbackBreakdown }[], modelVersion: string, today: number) {
  const header = ['payment', 'date', 'description', 'amount', 'held_now', 'standard_reserve', 'status', 'reasons', 'model_version']
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  const lines = rows.map(({ o, b }) =>
    [
      o.payment.id,
      dayLabel(o.payment.capturedDay),
      o.payment.description ?? '',
      (o.payment.amount / 100).toFixed(2),
      (b.total / 100).toFixed(2),
      (b.flat / 100).toFixed(2),
      statusOf(b, today - o.payment.capturedDay).label,
      b.reasons.join(' '),
      modelVersion,
    ]
      .map((v) => esc(String(v)))
      .join(','),
  )
  const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'thaw-holdbacks.csv'
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
