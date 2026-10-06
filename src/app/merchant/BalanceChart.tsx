import { useMemo } from 'react'
import { accountSeries } from '../../engine'
import { LineChart } from '../charts/LineChart'
import { dayLabel, dayLong, money } from '../lib/format'
import { useDemo } from '../state/demo'
import { Card, CardHeader } from '../ui'

/** Held balance, last 60 days and the next 90: Thaw against the standard reserve. */
export function BalanceChart() {
  const { visible, today, ctx } = useDemo()
  const points = useMemo(() => accountSeries(visible, today, ctx, today - 60, today + 90), [visible, today, ctx])
  const xs = points.map((p) => p.day)
  return (
    <Card>
      <CardHeader
        title="Held balance"
        subtitle="The last 60 days, then the next 90 for orders already taken (no new sales or proof assumed)"
      />
      <LineChart
        ariaLabel="Held balance over time, Thaw against the standard reserve"
        xs={xs}
        series={[
          { key: 'flat', label: 'Standard reserve', color: 'var(--flat)', values: points.map((p) => p.flat) },
          { key: 'thaw', label: 'Thaw', color: 'var(--s1)', values: points.map((p) => p.thaw), area: true },
        ]}
        xFormat={dayLabel}
        tooltipTitle={dayLong}
        yFormat={(v) => money(v)}
        marker={{ x: today, label: 'Today' }}
        shadeFrom={today}
        shadeLabel="Projected"
      />
    </Card>
  )
}
