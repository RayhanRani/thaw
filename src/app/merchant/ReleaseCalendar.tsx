import { useMemo } from 'react'
import { ColumnChart, type ColumnDatum } from '../charts/ColumnChart'
import { dayLabel, money } from '../lib/format'
import { useDemo } from '../state/demo'
import { Card, CardHeader } from '../ui'
import { FAMILY_COLOR, FAMILY_ORDER, FLOOR_COLOR } from './shared'

/** PRD 3.1: held dollars by release date, stacked by reason. Weekly buckets over the window. */
export function ReleaseCalendar() {
  const { releases, ctx, today } = useDemo()
  const data = useMemo<ColumnDatum[]>(() => {
    const weeks: ColumnDatum[] = []
    for (let w = 0; w * 7 < releases.length; w++) {
      const slice = releases.slice(w * 7, w * 7 + 7)
      const values: Record<string, number> = { floor: 0 }
      for (const t of FAMILY_ORDER) values[t] = 0
      let flat = 0
      for (const r of slice) {
        for (const t of FAMILY_ORDER) values[t] += r.byType[t]
        values.floor += r.floor
        flat += r.flat
      }
      weeks.push({ key: String(w), label: dayLabel(slice[0].day), values, reference: flat })
    }
    return weeks
  }, [releases])

  const series = [
    ...FAMILY_ORDER.map((t) => ({ key: t, label: ctx.model.types[t].label, color: FAMILY_COLOR[t] })),
    { key: 'floor', label: 'Account minimum', color: FLOOR_COLOR },
  ]
  const total = releases.reduce((s, r) => s + r.total, 0)

  return (
    <Card>
      <CardHeader
        title="Release calendar"
        subtitle={`${money(total)} comes back over the next ${releases.length} days from orders already taken. These are the latest dates: proof pulls them earlier.`}
      />
      <ColumnChart
        ariaLabel="Weekly releases by reason"
        data={data}
        series={series}
        yFormat={(v) => money(v)}
        referenceLabel="Standard reserve releases"
        tooltipFooter={(d) => `Week of ${d.label}`}
      />
      <p className="mt-2 text-xs text-muted">Weekly, starting {dayLabel(today + 1)}. The dark ticks show what today's standard reserve would release that week.</p>
    </Card>
  )
}
