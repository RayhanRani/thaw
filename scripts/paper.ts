/**
 * Builds the research paper as a PDF: text, tables and figures are generated from the engine and the
 * backtest snapshot, so every number matches the prototype.
 *
 *   npm run dev                                       (in another terminal, for the product screenshots)
 *   npm run paper -- --url http://localhost:5173
 *
 * Output: docs/paper/Thaw-Research-Paper.pdf (and the HTML it was printed from).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'
import { DEFAULT_POLICY, economics, PRD_ECONOMICS, PRD_TOY_MODEL, priceHoldback, THAW_PILOT_MODEL, type OrderState } from '../src/engine'

const args = process.argv.slice(2)
const argValue = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : fallback
}
const BASE = argValue('url', 'http://localhost:5173').replace(/\/$/, '')
const OUT = 'docs/paper'
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

// ---------------------------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------------------------
type Row = { seed: number; cut: number; cutNoFloor: number; controlLossBps: number; thawLossBps: number; noFloorLossBps: number; lossDeltaBps: number; pass: boolean; medianDaysThaw: number; earlyReleaseShare: number; killCaught: number; killFailingTotal: number; killHealthy: number; merchants: number }
type Point = { label: string; x: number; y: number }
type Seg = { segment: string; merchants: number; volume: number; control: { dollarDaysPer1k: number; lossBps: number }; treatment: { dollarDaysPer1k: number; lossBps: number } }
interface Snapshot {
  figures: { merchants: number; orders: number; frontier: { flat: Point[]; thaw: Point[] }; medianDaysThaw: number; earlyReleaseShare: number }
  defaultResult: {
    orders: number
    volume: number
    proofCoverage: number
    failures: { insolvent: number; bustOut: number }
    killSwitch: { failing: number; failingTotal: number; healthy: number; medianDaysBeforeFailure: number; bySignal: Record<string, { failing: number; healthy: number }> }
    release: { medianDaysThaw: number; earlyReleaseShareThaw: number; curve: { age: number; thaw: number; flat: number }[] }
    heldOverTime: { day: number; control: number; treatment: number }[]
    cuts: { dimension: string; rows: Seg[] }[]
    verdict: { dollarDaysCut: number; lossDeltaBps: number; bestAtControlLoss: { label: string; dollarDaysPer1k: number; lossBps: number } }
    control: { dollarDaysPer1k: number; lossBps: number }
    treatment: { dollarDaysPer1k: number; lossBps: number }
  }
  base: Row[]
  stress: Row[]
  adversarial: Row[]
  adversarialNewFlat: Row[]
}
const S: Snapshot = JSON.parse(readFileSync('src/app/data/snapshot.json', 'utf8'))
const R = S.defaultResult

const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`
const range = (xs: number[], f: (x: number) => string) => {
  const lo = Math.min(...xs)
  const hi = Math.max(...xs)
  return f(lo) === f(hi) ? f(lo) : `${f(lo)}–${f(hi)}`
}
const bps = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(2)}`
const usdShort = (d: number) => (d >= 1e9 ? `$${(d / 1e9).toFixed(d >= 1e10 ? 0 : 2).replace(/\.?0+$/, '')}B` : `$${Math.round(d / 1e6)}M`)

// The PRD worked example, priced by the engine.
const ORDER: OrderState = {
  payment: { id: 'py_1042', merchantId: 'acct_demo', amount: 100_00, capturedDay: 0, fulfillment: 'physical' },
  proofs: [
    { id: 'a', paymentId: 'py_1042', kind: 'authentication', source: 'stripe_3ds', day: 0 },
    { id: 'd', paymentId: 'py_1042', kind: 'delivery', source: 'carrier', day: 5 },
  ],
  adverse: [],
}
const toyAt = (day: number) => priceHoldback(ORDER, day, { model: PRD_TOY_MODEL, policy: DEFAULT_POLICY }).total / 100

// Scenario summaries (6 seeds each).
interface Scenario { name: string; setting: string; rows: Row[]; floor: boolean }
const SCENARIOS: Scenario[] = [
  { name: 'Base', setting: 'Per-order release, no floor', rows: S.base, floor: false },
  { name: 'Base', setting: 'Pilot: 30% unproven-volume floor', rows: S.base, floor: true },
  { name: '3× merchant failures', setting: 'Pilot', rows: S.stress, floor: true },
  { name: 'Fake delivery proof', setting: 'Pilot', rows: S.adversarial, floor: true },
  { name: 'Fake delivery proof', setting: 'Pilot, new merchants on flat', rows: S.adversarialNewFlat, floor: true },
]
const cutOf = (s: Scenario, r: Row) => (s.floor ? r.cut : r.cutNoFloor)
const deltaOf = (s: Scenario, r: Row) => (s.floor ? r.lossDeltaBps : r.noFloorLossBps - r.controlLossBps)
const passes = (s: Scenario) => s.rows.filter((r) => deltaOf(s, r) <= 0.5).length

const baseCut = S.base.reduce((a, r) => a + r.cut, 0) / S.base.length
const econ = economics(PRD_ECONOMICS)
const killBase = S.base.reduce((a, r) => ({ caught: a.caught + r.killCaught, total: a.total + r.killFailingTotal, healthy: a.healthy + r.killHealthy }), { caught: 0, total: 0, healthy: 0 })
const healthyBase = S.base.length * 300 - killBase.total

// ---------------------------------------------------------------------------------------------
// Charts (SVG, 1 unit = 1 CSS px)
// ---------------------------------------------------------------------------------------------
const C = { ink: '#0b1220', muted: '#5b6475', faint: '#94a3b8', grid: '#e5e9f0', today: '#94a3b8', todayLine: '#64748b', thaw: '#0284c7', thawFill: '#0ea5e9', good: '#15803d', goodFill: '#22c55e', bad: '#dc2626', accent: '#0284c7' }
const FONT = `font-family="Inter, 'Helvetica Neue', Arial, sans-serif"`
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')

interface Series { points: [number, number][]; color: string; width?: number; dash?: string; step?: boolean; fill?: string }
interface ChartOpts {
  w: number
  h: number
  x: [number, number]
  y: [number, number]
  xTicks: { v: number; l: string }[]
  yTicks: { v: number; l: string }[]
  xLabel?: string
  yLabel?: string
  series: Series[]
  between?: { a: [number, number][]; b: [number, number][]; fill: string }
  extra?: (sx: (v: number) => number, sy: (v: number) => number) => string
  pad?: { l: number; r: number; t: number; b: number }
  key?: { color: string; label: string; dash?: boolean }[]
  keyX?: number
}
function chart(o: ChartOpts): string {
  const p = o.pad ?? { l: 42, r: 14, t: 12, b: 34 }
  const sx = (v: number) => p.l + ((v - o.x[0]) / (o.x[1] - o.x[0])) * (o.w - p.l - p.r)
  const sy = (v: number) => o.h - p.b - ((v - o.y[0]) / (o.y[1] - o.y[0])) * (o.h - p.t - p.b)
  const path = (pts: [number, number][], step?: boolean) =>
    pts
      .map(([x, y], i) => {
        if (i === 0) return `M${sx(x).toFixed(1)},${sy(y).toFixed(1)}`
        if (step) return `H${sx(x).toFixed(1)}V${sy(y).toFixed(1)}`
        return `L${sx(x).toFixed(1)},${sy(y).toFixed(1)}`
      })
      .join('')
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${o.w}" height="${o.h}" viewBox="0 0 ${o.w} ${o.h}" ${FONT}>`
  for (const t of o.yTicks) s += `<line x1="${p.l}" x2="${o.w - p.r}" y1="${sy(t.v)}" y2="${sy(t.v)}" stroke="${C.grid}" stroke-width="1"/><text x="${p.l - 6}" y="${sy(t.v) + 3}" font-size="8.5" fill="${C.muted}" text-anchor="end">${esc(t.l)}</text>`
  for (const t of o.xTicks) s += `<text x="${sx(t.v)}" y="${o.h - p.b + 13}" font-size="8.5" fill="${C.muted}" text-anchor="middle">${esc(t.l)}</text>`
  s += `<line x1="${p.l}" x2="${o.w - p.r}" y1="${o.h - p.b}" y2="${o.h - p.b}" stroke="${C.faint}" stroke-width="1"/>`
  if (o.xLabel) s += `<text x="${(p.l + o.w - p.r) / 2}" y="${o.h - 4}" font-size="8.5" fill="${C.muted}" text-anchor="middle">${esc(o.xLabel)}</text>`
  if (o.yLabel) s += `<text transform="translate(10 ${(p.t + o.h - p.b) / 2}) rotate(-90)" font-size="8.5" fill="${C.muted}" text-anchor="middle">${esc(o.yLabel)}</text>`
  if (o.between) {
    const a = o.between.a.map(([x, y]) => `${sx(x).toFixed(1)},${sy(y).toFixed(1)}`)
    const b = [...o.between.b].reverse().map(([x, y]) => `${sx(x).toFixed(1)},${sy(y).toFixed(1)}`)
    s += `<polygon points="${[...a, ...b].join(' ')}" fill="${o.between.fill}"/>`
  }
  for (const se of o.series) {
    if (se.fill) s += `<path d="${path(se.points, se.step)}V${sy(o.y[0])}H${sx(se.points[0][0])}Z" fill="${se.fill}"/>`
    s += `<path d="${path(se.points, se.step)}" fill="none" stroke="${se.color}" stroke-width="${se.width ?? 2}" ${se.dash ? `stroke-dasharray="${se.dash}"` : ''} stroke-linejoin="round" stroke-linecap="round"/>`
  }
  if (o.extra) s += o.extra(sx, sy)
  if (o.key) {
    let kx = o.keyX ?? p.l + 8
    const ky = p.t + 8
    for (const k of o.key) {
      s += `<line x1="${kx}" x2="${kx + 14}" y1="${ky}" y2="${ky}" stroke="${k.color}" stroke-width="2.2" ${k.dash ? 'stroke-dasharray="4 3"' : ''}/><text x="${kx + 18}" y="${ky + 3}" font-size="8" fill="${C.muted}">${esc(k.label)}</text>`
      kx += 26 + k.label.length * 4.3
    }
  }
  return `${s}</svg>`
}
const legend = (items: { color: string; label: string; kind?: 'line' | 'box' | 'dot' }[]) =>
  `<div class="legend">${items
    .map((i) => `<span><i class="${i.kind ?? 'line'}" style="background:${i.color}"></i>${esc(i.label)}</span>`)
    .join('')}</div>`

// Figure 1: one $100 order.
const toyDays = Array.from({ length: 91 }, (_, d) => d)
const toyThaw: [number, number][] = toyDays.map((d) => [d, toyAt(d)])
const toyFlat: [number, number][] = [[0, 10], [90, 10], [90, 0]]
const fig1 = chart({
  w: 662,
  h: 200,
  x: [0, 92],
  y: [0, 11],
  xTicks: [0, 5, 15, 30, 45, 60, 75, 90].map((v) => ({ v, l: `Day ${v}` })),
  yTicks: [0, 2.5, 5, 7.5, 10].map((v) => ({ v, l: `$${v % 1 ? v.toFixed(2) : v}` })),
  yLabel: 'Held from a $100 order',
  pad: { l: 52, r: 16, t: 14, b: 26 },
  between: { a: [[0, 10], [90, 10]], b: [[0, 10], ...toyThaw.slice(0, 90)], fill: 'rgba(34,197,94,0.13)' },
  series: [
    { points: toyFlat, color: C.todayLine, width: 2, dash: '5 4' },
    { points: [[0, 10], [0, toyAt(0)], ...toyThaw.slice(1)], color: C.thaw, width: 2.4 },
  ],
  extra: (sx, sy) => {
    const tag = (x: number, y: number, text: string, dx = 6, dy = -6, anchor = 'start') =>
      `<circle cx="${sx(x)}" cy="${sy(y)}" r="3.2" fill="${C.thaw}" stroke="#fff" stroke-width="1.2"/><text x="${sx(x) + dx}" y="${sy(y) + dy}" font-size="8.5" fill="${C.ink}" text-anchor="${anchor}">${esc(text)}</text>`
    return (
      tag(0, toyAt(0), `3D Secure verified: $${toyAt(0).toFixed(2)}`, 7, -7) +
      tag(5, toyAt(5), `Carrier confirms delivery: $${toyAt(5).toFixed(2)}`, 7, -8) +
      tag(30, toyAt(30), `$${toyAt(30).toFixed(2)}`, 0, -9, 'middle') +
      tag(60, toyAt(60), `$${toyAt(60).toFixed(2)}`, 0, -9, 'middle') +
      `<text x="${sx(45)}" y="${sy(10) - 5}" font-size="8.5" fill="${C.todayLine}" text-anchor="middle">Today’s reserve: $10 for 90 days</text>` +
      `<text x="${sx(50)}" y="${sy(5.6)}" font-size="9" font-weight="600" fill="${C.good}" text-anchor="middle">Returned early with Thaw</text>`
    )
  },
})

// Figure 4: money held across 300 stores, a year.
const held = R.heldOverTime
const heldMax = Math.max(...held.map((h) => h.control)) / 100
const fig4 = chart({
  w: 322,
  h: 140,
  key: [{ color: C.todayLine, label: 'Today’s reserve', dash: true }, { color: C.thaw, label: 'Thaw' }],
  x: [0, 364],
  y: [0, Math.max(1_200_000, Math.ceil((heldMax * 1.35) / 200_000) * 200_000)],
  xTicks: [0, 91, 182, 273, 364].map((v, i) => ({ v, l: ['Start', '3 mo', '6 mo', '9 mo', '1 yr'][i] })),
  yTicks: [0, 200_000, 400_000, 600_000, 800_000].map((v) => ({ v, l: v ? `$${v / 1000}K` : '$0' })),
  pad: { l: 40, r: 10, t: 20, b: 22 },
  between: { a: held.map((h) => [h.day, h.control / 100] as [number, number]), b: held.map((h) => [h.day, h.treatment / 100] as [number, number]), fill: 'rgba(34,197,94,0.13)' },
  series: [
    { points: held.map((h) => [h.day, h.control / 100]), color: C.todayLine, width: 2, dash: '5 4' },
    { points: held.map((h) => [h.day, h.treatment / 100]), color: C.thaw, width: 2.4, fill: 'rgba(14,165,233,0.10)' },
  ],
  extra: (sx, sy) => {
    const e = held[held.length - 1]
    return `<text x="${sx(e.day) - 2}" y="${sy(e.control / 100) - 6}" font-size="8.5" fill="${C.todayLine}" text-anchor="end">$${Math.round(e.control / 100_000)}K</text><text x="${sx(e.day) - 2}" y="${sy(e.treatment / 100) - 6}" font-size="8.5" font-weight="600" fill="${C.thaw}" text-anchor="end">$${Math.round(e.treatment / 100_000)}K</text>`
  },
})

// Figure 5: release curve by order age.
const curve = R.release.curve
const fig5 = chart({
  w: 322,
  h: 140,
  x: [0, 90],
  y: [0, 1.05],
  xTicks: [0, 15, 30, 45, 60, 75, 90].map((v) => ({ v, l: v ? `Day ${v}` : 'Sale' })),
  yTicks: [0, 0.25, 0.5, 0.75, 1].map((v) => ({ v, l: pct(v) })),
  pad: { l: 38, r: 20, t: 20, b: 22 },
  between: { a: curve.slice(0, 90).map((c) => [c.age, c.flat] as [number, number]), b: curve.slice(0, 90).map((c) => [c.age, c.thaw] as [number, number]), fill: 'rgba(34,197,94,0.13)' },
  series: [
    { points: [[0, 1], [89.5, 1], [90, 0]], color: C.todayLine, width: 2, dash: '5 4' },
    { points: curve.map((c) => [c.age, c.thaw]), color: C.thaw, width: 2.4 },
  ],
  extra: (sx, sy) => {
    const m = S.figures.medianDaysThaw
    return `<line x1="${sx(m)}" x2="${sx(m)}" y1="${sy(0)}" y2="${sy(0.5)}" stroke="${C.thaw}" stroke-dasharray="2 3"/><line x1="${sx(0)}" x2="${sx(m)}" y1="${sy(0.5)}" y2="${sy(0.5)}" stroke="${C.thaw}" stroke-dasharray="2 3"/><circle cx="${sx(m)}" cy="${sy(0.5)}" r="3" fill="${C.thaw}"/><text x="${sx(m) + 6}" y="${sy(0.5) - 5}" font-size="8.5" font-weight="600" fill="${C.thaw}">Half released by day ${m}</text>`
  },
})

// Figure 6: loss change per simulated year, by scenario.
const fig6 = (() => {
  const w = 322
  const rowH = 30
  const top = 10
  const p = { l: 120, r: 12 }
  const h = top + rowH * SCENARIOS.length + 30
  const xMax = 1.8
  const sx = (v: number) => p.l + (Math.max(-0.05, v) / xMax) * (w - p.l - p.r)
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" ${FONT}>`
  s += `<rect x="${sx(0.5)}" y="${top - 4}" width="${sx(xMax) - sx(0.5)}" height="${rowH * SCENARIOS.length + 4}" fill="rgba(220,38,38,0.06)"/>`
  for (const v of [0, 0.5, 1, 1.5]) s += `<line x1="${sx(v)}" x2="${sx(v)}" y1="${top - 4}" y2="${top + rowH * SCENARIOS.length}" stroke="${v === 0.5 ? C.bad : C.grid}" ${v === 0.5 ? 'stroke-dasharray="4 3"' : ''}/><text x="${sx(v)}" y="${top + rowH * SCENARIOS.length + 13}" font-size="8.5" fill="${C.muted}" text-anchor="middle">${v === 0 ? '0' : `+${v}`}</text>`
  s += `<text x="${sx(0.5) + 4}" y="${top + 6}" font-size="8" fill="${C.bad}">Guardrail +0.5 bps</text>`
  s += `<text x="${(p.l + w - p.r) / 2}" y="${h - 3}" font-size="8.5" fill="${C.muted}" text-anchor="middle">Change in net loss vs today’s reserve (bps of volume)</text>`
  SCENARIOS.forEach((sc, i) => {
    const y = top + rowH * i + rowH / 2
    s += `<text x="${p.l - 8}" y="${y - 2}" font-size="8.5" fill="${C.ink}" text-anchor="end">${esc(sc.name)}</text><text x="${p.l - 8}" y="${y + 8}" font-size="7.5" fill="${C.muted}" text-anchor="end">${esc(sc.setting.replace('Pilot: 30% unproven-volume floor', 'Pilot floor').replace('Per-order release, no floor', 'No floor').replace('Pilot, new merchants on flat', 'New merchants flat'))}</text>`
    sc.rows.forEach((r, j) => {
      const d = deltaOf(sc, r)
      s += `<circle cx="${sx(d)}" cy="${y + (j - 2.5) * 2.2}" r="3.6" fill="${d <= 0.5 ? C.goodFill : C.bad}" fill-opacity="0.85" stroke="#fff" stroke-width="0.8"/>`
    })
  })
  return `${s}</svg>`
})()

// Figure 7: efficiency frontier.
const fr = S.figures.frontier
const fig7 = chart({
  w: 322,
  h: 180,
  key: [{ color: C.todayLine, label: 'Flat reserve 2–25%', dash: true }, { color: C.thaw, label: 'Thaw, floor 0–100%' }],
  keyX: 120,
  x: [0, 23000],
  y: [0, 7],
  xTicks: [0, 5000, 10000, 15000, 20000].map((v) => ({ v, l: v ? `${v / 1000}k` : '0' })),
  yTicks: [0, 2, 4, 6].map((v) => ({ v, l: `${v}` })),
  xLabel: 'Dollar-days held per $1,000 of volume',
  yLabel: 'Net loss (bps)',
  pad: { l: 34, r: 10, t: 20, b: 30 },
  series: [
    { points: fr.flat.map((p) => [p.x, p.y]), color: C.todayLine, width: 1.8, dash: '5 4' },
    { points: fr.thaw.map((p) => [p.x, p.y]), color: C.thaw, width: 2.2 },
  ],
  extra: (sx, sy) => {
    let s = ''
    for (const p of fr.flat) s += `<circle cx="${sx(p.x)}" cy="${sy(p.y)}" r="2.6" fill="#fff" stroke="${C.todayLine}" stroke-width="1.4"/>`
    for (const p of fr.thaw) s += `<circle cx="${sx(p.x)}" cy="${sy(p.y)}" r="2.6" fill="${C.thaw}"/>`
    const pilot = fr.thaw.find((p) => p.label === 'Thaw, floor 30%')!
    const ctrl = fr.flat.find((p) => p.label === 'Flat 10%')!
    s += `<circle cx="${sx(pilot.x)}" cy="${sy(pilot.y)}" r="5" fill="none" stroke="${C.thaw}" stroke-width="1.5"/><text x="${sx(pilot.x) - 2}" y="${sy(pilot.y) - 10}" font-size="8.5" font-weight="600" fill="${C.thaw}" text-anchor="middle">Thaw pilot</text>`
    s += `<circle cx="${sx(ctrl.x)}" cy="${sy(ctrl.y)}" r="5" fill="none" stroke="${C.todayLine}" stroke-width="1.5"/><text x="${sx(ctrl.x) + 6}" y="${sy(ctrl.y) - 10}" font-size="8.5" fill="${C.todayLine}">Today: flat 10%</text>`
    const f4 = fr.flat.find((p) => p.label === 'Flat 4%')!
    s += `<text x="${sx(f4.x) + 7}" y="${sy(f4.y) + 3}" font-size="8" fill="${C.todayLine}">flat 4%</text>`
    const f2 = fr.flat.find((p) => p.label === 'Flat 2%')!
    s += `<text x="${sx(f2.x) + 7}" y="${sy(f2.y) + 3}" font-size="8" fill="${C.todayLine}">flat 2%</text>`
    return s
  },
})

// Figure 2: system architecture.
const box = (x: number, y: number, w: number, h: number, title: string, sub: string, tone: 'plain' | 'accent' | 'soft' = 'plain') => {
  const fill = tone === 'accent' ? '#e0f2fe' : tone === 'soft' ? '#f8fafc' : '#ffffff'
  const stroke = tone === 'accent' ? '#0284c7' : '#cbd5e1'
  const lines = sub.split('\n')
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="${fill}" stroke="${stroke}" stroke-width="1.2"/><text x="${x + w / 2}" y="${y + (lines.length > 1 ? h / 2 - 6 - (lines.length - 1) * 5 : h / 2 - 3)}" font-size="9.5" font-weight="600" fill="${C.ink}" text-anchor="middle">${esc(title)}</text>${lines.map((l, i) => `<text x="${x + w / 2}" y="${y + (lines.length > 1 ? h / 2 + 7 - (lines.length - 1) * 5 + i * 10.5 : h / 2 + 10)}" font-size="8" fill="${C.muted}" text-anchor="middle">${esc(l)}</text>`).join('')}`
}
const arrow = (x1: number, y1: number, x2: number, y2: number, color = '#64748b', dash = '') => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="1.3" ${dash ? `stroke-dasharray="${dash}"` : ''} marker-end="url(#arr)"/>`
const defs = `<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#64748b"/></marker></defs>`
const fig2 = (() => {
  const w = 662
  const h = 226
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" ${FONT}>${defs}`
  s += `<text x="70" y="12" font-size="8" font-weight="600" fill="${C.muted}" text-anchor="middle" letter-spacing="1">EVIDENCE</text>`
  const ev = [
    ['Authentication', '3D Secure, chip'],
    ['Delivery', 'carrier-verified tracking'],
    ['Usage', 'billing meter events'],
    ['Refunds', 'refund records'],
  ]
  ev.forEach(([t, d], i) => (s += box(0, 20 + i * 50, 140, 40, t, d, 'soft')))
  s += box(196, 52, 170, 96, 'Holdback engine', 'Prices each order\nH = A · r · Σ w·m(e)·S(t)\nre-prices on every event', 'accent')
  ev.forEach((_, i) => (s += arrow(141, 40 + i * 50, 194, 100)))
  s += box(196, 170, 170, 46, 'Risk signals', 'disputes, Radar flags,\nkill-switch alerts')
  s += arrow(281, 169, 281, 150, C.bad)
  s += `<text x="300" y="162" font-size="7.5" fill="${C.bad}">raise to flat</text>`
  s += box(420, 52, 120, 96, 'Account ledger', 'floor on unproven\nvolume · never above\nflat · kill switch')
  s += arrow(367, 100, 418, 100)
  s += `<text x="600" y="12" font-size="8" font-weight="600" fill="${C.muted}" text-anchor="middle" letter-spacing="1">OUTCOMES</text>`
  const out = [
    ['Release', 'to available balance'],
    ['Thaw Meter', 'reason + date per dollar'],
    ['Thaw Advance', 'borrow against releases'],
    ['Risk console', 'controls + audit log'],
  ]
  out.forEach(([t, d], i) => {
    s += box(560, 20 + i * 50, 102, 40, t, d, i === 0 ? 'accent' : 'soft')
    s += arrow(541, 100, 558, 40 + i * 50)
  })
  return `${s}</svg>`
})()

// Figure 3: backtest design.
const fig3 = (() => {
  const w = 662
  const h = 128
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" ${FONT}>${defs}`
  s += box(0, 28, 150, 72, 'Synthetic world', '300 merchants, 365 days\n≈670k payments, proof,\ndisputes, failures', 'soft')
  s += box(184, 10, 160, 46, 'Control ledger', 'flat 10% for 90 days')
  s += box(184, 72, 160, 46, 'Thaw ledger', 'per-order holdbacks + floor\n+ kill switch', 'accent')
  s += arrow(151, 56, 182, 33)
  s += arrow(151, 72, 182, 95)
  s += `<text x="160" y="62" font-size="7" fill="${C.muted}" text-anchor="middle">same</text><text x="160" y="70" font-size="7" fill="${C.muted}" text-anchor="middle">events</text>`
  s += box(378, 28, 140, 72, 'Metrics', 'dollar-days per $1k\nnet loss (bps)\nrelease timing, alerts', 'soft')
  s += arrow(345, 33, 376, 56)
  s += arrow(345, 95, 376, 72)
  s += box(552, 28, 110, 72, 'Verdict', 'pass if Thaw loss\n≤ control + 0.5 bps\nin every world', 'accent')
  s += arrow(519, 64, 550, 64)
  return `${s}</svg>`
})()

// ---------------------------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------------------------
const pm = THAW_PILOT_MODEL.types
const defused: Record<string, string> = {
  fraud: 'Authentication (3D Secure, chip)',
  not_received: 'Carrier-confirmed delivery; usage for digital',
  not_as_described: 'Usage, for digital and subscriptions',
  credit_not_processed: 'A refund already issued',
}
const typeName: Record<string, string> = { fraud: 'Fraud, unauthorized', not_received: 'Not received', not_as_described: 'Not as described', credit_not_processed: 'Credit not processed' }
const table1 = `<table><thead><tr><th>Dispute type</th><th class="num">Share of reserve (w)</th><th>Evidence that defuses it</th><th class="num">Risk left after proof (m)</th><th>Timing (Weibull k, λ)</th></tr></thead><tbody>${(Object.keys(pm) as (keyof typeof pm)[])
  .map((k) => {
    const t = pm[k]
    const c = t.curve.kind === 'weibull' ? `${t.curve.shape}, ${t.curve.scaleDays} days` : 'linear'
    return `<tr><td>${typeName[k]}</td><td class="num">${pct(t.weight)}</td><td>${defused[k]}</td><td class="num">${pct(t.residualAfterProof)}</td><td>${c}${t.withoutProof === 'hold' ? '; held flat until proven' : ''}</td></tr>`
  })
  .join('')}</tbody></table>`

const table2 = `<table><thead><tr><th>Scenario</th><th>Thaw setting</th><th class="num">Dollar-days cut</th><th class="num">Median days to release</th><th class="num">Loss vs control (bps)</th><th class="num">Within guardrail</th></tr></thead><tbody>${SCENARIOS.map((sc) => {
  const p = passes(sc)
  const med = sc.floor ? range(sc.rows.map((r) => r.medianDaysThaw), (x) => `${x}`) : '—'
  return `<tr class="${p === sc.rows.length ? '' : 'warn'}"><td>${sc.name}</td><td>${sc.setting}</td><td class="num">${range(sc.rows.map((r) => cutOf(sc, r)), (x) => pct(x))}</td><td class="num">${med}</td><td class="num">${bps(Math.min(...sc.rows.map((r) => deltaOf(sc, r))))} to ${bps(Math.max(...sc.rows.map((r) => deltaOf(sc, r))))}</td><td class="num"><b>${p} of ${sc.rows.length}</b></td></tr>`
}).join('')}</tbody></table>`

const sig = R.killSwitch.bySignal
const sigName: Record<string, string> = { proof_coverage_drop: 'Proof coverage drop', dispute_spike: 'Dispute spike', volume_spike: 'Volume spike' }
const sigRule: Record<string, string> = {
  proof_coverage_drop: 'Unproven share of 10–16-day-old orders up ≥30 pts vs baseline, z ≥ 4.5',
  dispute_spike: '14-day disputes vs prior 90 days, Poisson tail p < 10⁻⁵',
  volume_spike: '7-day volume ≥ 2× baseline, Poisson tail p < 10⁻⁶',
}
const table3 = `<table><thead><tr><th>Signal</th><th>Rule</th><th class="num">Failing caught</th><th class="num">Healthy flagged</th></tr></thead><tbody>${Object.entries(sig)
  .sort((a, b) => b[1].failing - a[1].failing)
  .map(([k, v]) => `<tr><td>${sigName[k]}</td><td>${sigRule[k]}</td><td class="num">${v.failing}</td><td class="num">${v.healthy}</td></tr>`)
  .join('')}<tr class="total"><td>Any signal</td><td>Reference world; first alert switches the merchant to flat</td><td class="num">${R.killSwitch.failing} of ${R.killSwitch.failingTotal}</td><td class="num">${R.killSwitch.healthy} of ${300 - R.killSwitch.failingTotal}</td></tr></tbody></table>`

const segRows = R.cuts.flatMap((c) => c.rows.map((r) => ({ dim: c.dimension, ...r })))
const segTable = (dims: string[]) =>
  `<table><thead><tr><th>Segment</th><th class="num">Stores</th><th class="num">Cut</th><th class="num">Loss bps, today → Thaw</th></tr></thead><tbody>${R.cuts
    .filter((c) => dims.includes(c.dimension))
    .map(
      (c) =>
        `<tr class="group"><td colspan="4">${c.dimension}</td></tr>` +
        c.rows
          .map((r) => `<tr><td>${r.segment}</td><td class="num">${r.merchants}</td><td class="num"><b>${pct(1 - r.treatment.dollarDaysPer1k / r.control.dollarDaysPer1k)}</b></td><td class="num">${r.control.lossBps.toFixed(2)} → ${r.treatment.lossBps.toFixed(2)}</td></tr>`)
          .join(''),
    )
    .join('')}</tbody></table>`
const table4 = `<div class="two tables">${segTable(['Proof coverage', 'Merchant age'])}${segTable(['Category', 'Region'])}</div>`
const cutFor = (segment: string) => {
  const r = segRows.find((x) => x.segment === segment)!
  return pct(1 - r.treatment.dollarDaysPer1k / r.control.dollarDaysPer1k)
}
const svc = segRows.find((r) => r.segment === 'Service')!
const svcCut = 1 - svc.treatment.dollarDaysPer1k / svc.control.dollarDaysPer1k

const shares = [0.001, 0.005, 0.01]
const table5 = `<table><thead><tr><th class="num">Share of volume held</th><th class="num">Volume held per year</th><th class="num">Average balance held</th><th class="num">Returned at a ${pct(baseCut)} cut</th></tr></thead><tbody>${shares
  .map((h) => {
    const e = economics({ ...PRD_ECONOMICS, heldShare: h })
    return `<tr${h === 0.005 ? ' class="hl"' : ''}><td class="num">${(h * 100).toFixed(1)}%</td><td class="num">${usdShort(e.volumeHeldPerYear)}</td><td class="num">${usdShort(e.averageBalanceHeld)}</td><td class="num"><b>${usdShort(e.averageBalanceHeld * baseCut)}</b></td></tr>`
  })
  .join('')}</tbody></table>`

// ---------------------------------------------------------------------------------------------
// Product screenshots
// ---------------------------------------------------------------------------------------------
const browser = await chromium.launch({ executablePath: CHROME, headless: true })
async function shot(hash: string, index: number): Promise<string> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, reducedMotion: 'reduce' })
  await page.goto(`${BASE}/#/${hash}`, { waitUntil: 'networkidle' })
  await page.addStyleTag({ content: '[data-demo-dock]{display:none!important}' })
  await page.waitForTimeout(600)
  const el = page.locator('main section.card').nth(index)
  await el.scrollIntoViewIfNeeded()
  const buf = await el.screenshot({ type: 'jpeg', quality: 88, animations: 'disabled' })
  await page.close()
  return `data:image/jpeg;base64,${buf.toString('base64')}`
}
const shotMerchant = await shot('merchant', 0)
const shotSale = await shot('merchant', 2)
const shotYear = await shot('admin', 1)
const shotAdmin = await shot('admin', 2)

// ---------------------------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------------------------
const interPath = resolve('node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2')
const fig = (n: number, body: string, caption: string, cls = '') => `<figure class="${cls}">${body}<figcaption><b>Figure ${n}.</b> ${caption}</figcaption></figure>`
const sp = R.verdict
const noFloorBase = SCENARIOS[0]
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Thaw: Releasing Merchant Reserves on Evidence, Not the Calendar</title>
<style>
@font-face { font-family: 'Inter'; src: url('file://${interPath}') format('woff2'); font-weight: 100 900; }
@page { size: Letter; margin: 0.72in 0.78in 0.78in 0.78in; }
:root { --ink:#0b1220; --muted:#5b6475; --line:#d8dee8; --accent:#0284c7; --soft:#f1f6fb; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin:0; color:var(--ink); font-family: Charter, 'Bitstream Charter', Georgia, serif; font-size: 10.2pt; line-height: 1.5; hyphens: auto; }
h1,h2,h3,.sans,figcaption,table,.legend,.kicker,.meta,.stat,.callout b,.tcap { font-family: Inter, 'Helvetica Neue', Arial, sans-serif; hyphens: manual; }
p { margin: 0 0 7pt; text-align: justify; }
.kicker { font-size: 8pt; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; color: var(--accent); }
h1 { font-size: 23pt; line-height: 1.12; letter-spacing: -0.02em; margin: 6pt 0 5pt; font-weight: 700; }
.subtitle { font-family: Inter, sans-serif; font-size: 11pt; color: var(--muted); margin: 0 0 9pt; line-height: 1.35; }
.meta { font-size: 8.5pt; color: var(--muted); border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); padding: 5pt 0; margin-bottom: 11pt; display:flex; justify-content: space-between; gap: 12pt; }
.meta b { color: var(--ink); font-weight: 600; }
.abstract { background: var(--soft); border-left: 3px solid var(--accent); padding: 9pt 12pt 3pt; margin-bottom: 11pt; }
.abstract h3 { font-size: 8pt; letter-spacing: 0.14em; text-transform: uppercase; color: var(--accent); margin: 0 0 4pt; }
.abstract p { font-size: 9.6pt; }
.stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8pt; margin: 0 0 12pt; }
.stat { border: 1px solid var(--line); border-radius: 7px; padding: 7pt 9pt; }
.stat .v { font-size: 17pt; font-weight: 700; letter-spacing: -0.02em; color: var(--accent); line-height: 1.1; }
.stat .l { font-size: 7.6pt; color: var(--muted); line-height: 1.3; margin-top: 2pt; }
h2 { font-size: 13pt; font-weight: 700; letter-spacing: -0.01em; margin: 14pt 0 6pt; padding-top: 6pt; border-top: 1px solid var(--line); break-after: avoid; }
h2 .n { color: var(--accent); margin-right: 6pt; }
h3 { font-size: 10pt; font-weight: 600; margin: 9pt 0 3pt; break-after: avoid; }
figure { margin: 8pt 0 10pt; break-inside: avoid; }
figure svg, figure img { display: block; max-width: 100%; height: auto; }
figure img { border-radius: 6px; border: 1px solid #1e2531; }
figcaption { font-size: 8pt; color: var(--muted); margin-top: 4pt; line-height: 1.4; text-align: left; }
figcaption b { color: var(--ink); }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 18pt; break-inside: avoid; }
.two.tables { gap: 16pt; align-items: start; }
.two.tables table { margin-top: 2pt; }
.two figure { margin-top: 4pt; }
.legend { font-size: 7.8pt; color: var(--muted); display:flex; flex-wrap: wrap; gap: 4pt 12pt; margin: 2pt 0 2pt; }
.legend span { display:inline-flex; align-items:center; gap: 5px; }
.legend i { display:inline-block; width: 14px; height: 2.5px; border-radius: 2px; }
.legend i.box { height: 9px; width: 11px; border-radius: 2px; }
.legend i.dot { height: 8px; width: 8px; border-radius: 50%; }
table { width: 100%; border-collapse: collapse; font-size: 8pt; margin: 6pt 0 4pt; break-inside: avoid; }
th { text-align: left; font-weight: 600; color: var(--muted); border-top: 1.4px solid var(--ink); border-bottom: 1px solid var(--ink); padding: 4pt 5pt; vertical-align: bottom; line-height: 1.25; }
td { padding: 3.4pt 5pt; border-bottom: 1px solid #e7ebf1; vertical-align: top; line-height: 1.3; }
tbody tr:last-child td { border-bottom: 1.4px solid var(--ink); }
.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
tr.warn td { background: #fef2f2; }
tr.hl td { background: #f0f9ff; }
tr.total td { font-weight: 600; background: #f8fafc; }
tr.group td { font-weight: 600; color: var(--accent); background: #f8fafc; font-size: 7.6pt; letter-spacing: 0.06em; text-transform: uppercase; }
.tcap { font-family: Inter, sans-serif; font-size: 8pt; color: var(--muted); margin: 8pt 0 0; break-after: avoid; }
.tcap b { color: var(--ink); }
.eq { text-align: center; font-size: 12pt; margin: 6pt 0 8pt; font-style: italic; }
.eq sub { font-size: 0.7em; }
.callout { border: 1px solid var(--line); border-radius: 7px; padding: 8pt 11pt 2pt; margin: 8pt 0 10pt; background: #fbfdff; break-inside: avoid; }
.callout b { font-size: 9pt; }
ol.findings { padding-left: 15pt; margin: 4pt 0 8pt; }
ol.findings li { margin-bottom: 5pt; text-align: justify; }
ul { margin: 2pt 0 8pt; padding-left: 15pt; }
li { margin-bottom: 3pt; }
.refs { font-size: 8pt; line-height: 1.4; columns: 2; column-gap: 18pt; }
.refs p { text-align: left; margin-bottom: 3pt; break-inside: avoid; }
.shots { display: grid; grid-template-columns: 1fr 1fr; gap: 9pt; align-items: start; }
.small { font-size: 8.4pt; color: var(--muted); }
.nb { break-before: page; }
</style></head><body>

<div class="kicker">Research paper · Product concept · October 2026</div>
<h1>Thaw: Releasing Merchant Reserves on Evidence, Not the Calendar</h1>
<div class="subtitle">A proposal for per-order, proof-priced holdbacks, with a working prototype and a shadow-mode simulation of ${S.figures.merchants} merchants over a year</div>
<div class="meta"><span><b>Rayhan Rani</b> · Independent concept for a Product Manager application</span><span>Not affiliated with Stripe · All data synthetic</span></div>

<div class="abstract"><h3>Abstract</h3>
<p>Payment processors protect themselves from chargebacks on riskier merchants with rolling reserves: a fixed share of sales held for a fixed number of days. Public sources put these at 5–25% of volume for 90–180 days, and frozen funds are the most common complaint in Stripe’s public reviews. The calendar is a crude proxy. The risk on an order falls sharply as evidence arrives: authentication answers fraud, carrier-confirmed delivery answers non-receipt, usage answers “not as described.” I propose <b>Thaw</b>, which prices the holdback on every order by the dispute risk still ahead of it and releases each slice as the evidence that defuses it arrives. I built the proposal as a working engine and product prototype and tested it in a shadow-mode backtest: ${S.figures.merchants} synthetic merchants and about ${Math.round(R.orders / 1000)}k payments, replayed under today’s flat reserve and under Thaw on identical events, across four scenarios and six simulated years each. With a floor on unproven volume, Thaw held ${range(S.base.map((r) => r.cut), (x) => pct(x))} fewer dollar-days at loss parity in all six base years, returned half of held money within ${range(S.base.map((r) => r.medianDaysThaw), (x) => `${x}`)} days instead of 90, and flagged ${pct(killBase.caught / killBase.total)} of failing merchants before they failed. Building it changed the design in four places. The binding risk is falsified proof, which keeping new merchants on the flat schedule closes.</p></div>

<div class="stats">
<div class="stat"><div class="v">${pct(baseCut)} less</div><div class="l">merchant money on hold (dollar-days), mean of six base years</div></div>
<div class="stat"><div class="v">Day ${S.figures.medianDaysThaw}</div><div class="l">half of held money returned, versus day 90 under the flat reserve</div></div>
<div class="stat"><div class="v">6 of 6</div><div class="l">base years within the loss guardrail (Thaw ≤ control + 0.5 bps)</div></div>
<div class="stat"><div class="v">≈${usdShort(econ.averageBalanceHeld * baseCut)}</div><div class="l">returned to merchants at Stripe scale, using the PRD’s illustrative sizing</div></div>
</div>

<h2><span class="n">1</span>The problem</h2>
<p>When a processor judges a merchant risky, it withholds part of every payout as collateral against future chargebacks. In a <i>rolling reserve</i>, a fixed share of each day’s sales is held for a fixed window and then released. Public guides describe reserves of <b>5–25% of volume held 90–180 days</b>, closure holds of similar length, and 7–14 day holds on new accounts [3, 4]. The window exists because card networks allow disputes up to roughly 120 days after a transaction [5], and held funds typically earn the merchant no interest [6].</p>
<p>For a small merchant, that money is inventory, payroll and ad spend. The frustration is visible: Stripe holds a <b>1.6 out of 5</b> rating on Trustpilot [1], with reviews repeatedly describing months-long holds, no stated end date and appeals rejected without explanation. Those sources over-represent unhappy customers, so they are a signal of pain rather than a measurement of its size. They point to four things a held merchant cannot see today: which risk a hold protects against, when each held dollar will be released, what they could do to shorten it, and when an appeal will be answered.</p>

${fig(1, fig1 + legend([{ color: C.todayLine, label: 'Today’s reserve (10% for 90 days)' }, { color: C.thaw, label: 'Thaw' }, { color: 'rgba(34,197,94,0.35)', label: 'Returned early', kind: 'box' }]), 'One $100 order under today’s reserve and under Thaw, priced by the engine with the PRD’s illustrative toy model: risk split 50% fraud, 25% non-receipt, 25% other; fraud cover released on 3D Secure, delivery cover on carrier confirmation, the rest decaying to day 90. In this model the average holdback falls to 22% of the flat reserve’s dollar-days, a 78% cut.')}

<h2><span class="n">2</span>Core insight: one reserve, four risks</h2>
<p>A reserve is priced by the calendar, but dispute risk is decided by evidence. Chargeback risk is not one risk. Each dispute family has its own proof that defuses it, and that proof usually arrives within days of the sale, long before the reserve window closes. A flat reserve treats all four families alike and ignores what has already happened to the order. Stripe is unusually well placed to act on this. It sees authorization, authentication, refunds, disputes and usage in one ledger, and it already sells the adjacent pieces: Radar, Billing, Capital and Smart Disputes [9, 12]. Proof-based release exists elsewhere only for short holds. PayPal, for example, releases some holds about 24 hours after carrier-confirmed delivery, but not long chargeback reserves [8].</p>

<p class="tcap"><b>Table 1.</b> The pilot risk model. Each family’s weight is its share of the capture-day holdback; proof leaves a small residual because liability shifts are not universal and delivered goods still draw some claims.</p>
${table1}

<h2><span class="n">3</span>Design</h2>
<h3>3.1 Pricing a holdback per order</h3>
<p>The PRD defines the holdback on order <i>i</i> as its expected unrecovered loss, <i>H<sub>i</sub>(t) = A<sub>i</sub> Σ<sub>k</sub> P<sub>k</sub>(t | e<sub>i,k</sub>) c<sub>k</sub></i>. To keep Thaw inside today’s risk appetite, the engine anchors on the reserve rate Risk already applies and factors the expected loss as</p>
<div class="eq">H<sub>i</sub>(t) = A<sub>i</sub> · r · Σ<sub>k</sub> w<sub>k</sub> · m<sub>k</sub>(e<sub>i,k</sub>) · S<sub>k</sub>(t)</div>
<p>where <i>r</i> is the account’s reserve rate (10% here), <i>w<sub>k</sub></i> the share of the reserve attributed to dispute family <i>k</i>, <i>m<sub>k</sub></i> an evidence multiplier (1 with no proof, the residual in Table 1 with fully trusted proof), and <i>S<sub>k</sub>(t)</i> the share of family-<i>k</i> risk still ahead on day <i>t</i>, a Weibull time-to-dispute curve truncated at the 90-day window. Three properties follow by construction. At capture Thaw holds exactly what Risk holds today. More proof can only lower a holdback. And a slice whose proof is missing falls back to the flat schedule rather than decaying faster. Proof sources carry trust tiers: verified sources (Stripe’s own 3D Secure result, carrier-confirmed tracking) earn full credit, trusted integrations partial credit, and merchant-asserted delivery none at all. A merchant’s first 100 verified orders season from half to full credit, and a Radar flag blocks early release on a single order.</p>

${fig(2, fig2, 'System architecture. Evidence and risk signals feed a per-order pricing engine; an account ledger applies the floor, the cap and the kill switch before any dollar is released. The same priced schedule drives the merchant’s Thaw Meter, Thaw Advance and the risk team’s console.')}

<h3>3.2 Account-level guardrails</h3>
<p>Per-order prices are necessary but not sufficient (Section 6). The account ledger enforces four rules on top of them. <b>A floor on unproven volume:</b> at least 30% of the last 30 days of sales that still lack verified delivery or usage stays held; the floor grows by itself when a merchant stops shipping. <b>A cap:</b> Thaw never holds more than the flat reserve would. <b>Disputes raise, never spend:</b> a disputed order returns to the flat schedule until its window ends. <b>A kill switch:</b> Risk, or an automatic alert, can return any merchant to the flat reserve at once.</p>

<h3>3.3 Product surfaces</h3>
<p>The priced schedule is shown, not hidden. The <b>Thaw Meter</b> gives the merchant every held dollar with a plain-language reason and a release date, plus a speed-up list ranked by dollars unlocked (for example, orders missing tracking). <b>Thaw Advance</b> lends up to 80% of releases expected in the next 60 days, net of expected disputes. Its fee is one fixed dollar amount built from cost of funds, expected loss and margin, it is repaid by netting scheduled releases, and new advances pause automatically when a merchant’s dispute rate doubles. <b>Fair process</b> adds reason codes on every change, appeals with a business-day deadline and a written decision, and human review above a dollar threshold. Risk sees the same store in a console with the safety switch and a full audit log of every holdback change, its inputs and the model version.</p>

<h2><span class="n">4</span>Evaluation method: a shadow-mode backtest</h2>
<p>The PRD’s central ask is a shadow-mode test: run Thaw beside the existing reserve, move no money, and check whether it releases earlier at equal or lower loss. Without access to Stripe’s data, I built the harness and ran it on a synthetic world calibrated to public, order-of-magnitude assumptions. Every merchant, payment, proof and dispute is replayed through two ledgers on identical events (Figure 3).</p>
${fig(3, fig3, 'Backtest design: identical events run through two ledgers, and Thaw passes only if its net loss stays within 0.5 bps of control in every simulated year.')}
<p><b>Loss accounting.</b> A live merchant pays its own disputes from incoming sales, so a reserve is really insurance against <i>merchant failure</i>: the processor loses money only when a merchant has stopped processing and later disputes exceed what is still held. The simulation models two kinds of failure. In an <i>insolvency</i>, a merchant leaves 75% of its last three weeks of orders unfulfilled. In a <i>bust-out</i>, volume ramps 3× over 30 days, 85% of orders go unfulfilled and 30% carry gamed proof. Annual rates are 5% and 2.5% for new merchants, and 2% and 0.3% for established ones.</p>
<p><b>World and scenarios.</b> Half of merchants sell physical goods; the rest sell digital, subscription or service products, across four regions. 3D Secure rates vary by region (25–65% in the US, 85–97% in the EU) and proof rates by category. Base dispute rates are 0.35% fraud, 0.25% non-receipt, 0.20% not-as-described and 0.08% credit, with Weibull delays. Evidence lowers risk: authenticated fraud carries half the risk, and delivered orders a fifth of the non-receipt risk. There are four scenarios: a base world; a stress world with three times the failures; an adversarial world where bust-outs ship empty parcels with real, carrier-verified tracking; and that world with new merchants kept on the flat schedule. Each runs on six seeds and is scored on the PRD’s pre-registered metrics: dollar-days held per $1,000 of volume, release timing, and net loss in basis points of volume.</p>

<h2><span class="n">5</span>Results</h2>
<h3>5.1 Less money held, returned sooner</h3>
<p>In the reference world (${Math.round(R.orders / 1000)}k payments, $${(R.volume / 1e8).toFixed(1)}M volume), Thaw held ${pct(sp.dollarDaysCut)} fewer dollar-days than the flat reserve, with a loss difference of ${bps(sp.lossDeltaBps)} bps; across the six base years the cut ranged from ${range(S.base.map((r) => r.cut), (x) => pct(x))}. Thaw’s balance plateaus within the first month at about $${Math.round(held[held.length - 1].treatment / 100_000)}K, while the flat reserve climbs to $${Math.round(held[held.length - 1].control / 100_000)}K (Figure 4). ${pct(1 - curve[0].thaw)} of an order’s reserve returns on the day of sale, half by day ${S.figures.medianDaysThaw}, and ${pct(R.release.earlyReleaseShareThaw)} of held dollars before the flat reserve’s date (Figure 5).</p>
<div class="two">
${fig(4, fig4, `Money held across all ${S.figures.merchants} stores, over one year.`)}
${fig(5, fig5, `Share of an order’s reserve still held, by day.`)}
</div>

<h3>5.2 Safety across scenarios</h3>
<p>Table 2 and Figure 6 report every scenario. With the pilot floor, Thaw stays inside the guardrail in all six base and all six stress years. Without the floor, it holds ${range(noFloorBase.rows.map((r) => r.cutNoFloor), (x) => pct(x))} less, but net loss is higher than control in every year and breaks the guardrail in ${noFloorBase.rows.length - passes(noFloorBase)} of six. Falsified proof is the binding risk: when bust-outs ship empty parcels with real tracking, the pilot breaks the guardrail in one of six years. Keeping new merchants on the flat schedule until they have earned trust closes the gap, still with ${range(S.adversarialNewFlat.map((r) => r.cut), (x) => pct(x))} less held. This is step 2 of the PRD’s calibration plan, now supported by evidence. Figure 7 shows why a floor beats simply lowering the flat rate: the same reduction in money held costs ten to eighteen times the loss, and a 40% floor matches control’s loss exactly while still holding ${pct(1 - sp.bestAtControlLoss.dollarDaysPer1k / R.control.dollarDaysPer1k)} less.</p>
<p class="tcap"><b>Table 2.</b> Scenario results, six simulated years each. Ranges are across years; shaded rows break the guardrail at least once.</p>
${table2}
<div class="two">
${fig(6, fig6 + legend([{ color: C.goodFill, label: 'Within guardrail', kind: 'dot' }, { color: C.bad, label: 'Over guardrail', kind: 'dot' }]), 'Change in net loss for every simulated year; the red band is outside the guardrail.')}
${fig(7, fig7, `Efficiency frontier. Matching Thaw’s holdings with a lower flat rate (4–6%) costs 10–18× the loss.`)}
</div>

<h3>5.3 Early warning</h3>
<p>Three statistical alerts watch every Thaw merchant and switch it to the flat schedule on the first alert (Table 3). In the reference world they caught ${R.killSwitch.failing} of ${R.killSwitch.failingTotal} failing merchants, a median of ${R.killSwitch.medianDaysBeforeFailure} days before failure, while flagging ${R.killSwitch.healthy} healthy ones. Across the six base years they caught ${killBase.caught} of ${killBase.total} (${pct(killBase.caught / killBase.total)}) and flagged ${killBase.healthy} of ${healthyBase.toLocaleString('en-US')} healthy merchants (${pct(killBase.healthy / healthyBase, 1)}). A falling share of orders with delivery proof was the strongest signal: a merchant who stops shipping stops producing proof. A first version that used simple thresholds flagged 123 healthy merchants, which is why the alerts are now formal tests.</p>
<p class="tcap"><b>Table 3.</b> Kill-switch signals in the reference world.</p>
${table3}

<h3>5.4 Who benefits</h3>
<p>The PRD warns that a gain concentrated in already-safe merchants is not a win, so results are cut by segment (Table 4). The cut is the same for new and established merchants and similar across regions. What drives it is proof: merchants with at least 80% of orders proven hold ${cutFor('80% and up')} less, against ${cutFor('Under 50%')} for those under half. That is the incentive the design intends: merchants who send proof are paid sooner. Service businesses gain least (${pct(svcCut)}) because little of their work produces proof today, so attendance or completion proof is the next source worth building.</p>
<p class="tcap"><b>Table 4.</b> Cut in dollar-days held, and net loss, by segment (reference world).</p>
${table4}

<h2><span class="n">6</span>What building it changed</h2>
<p>The PRD’s toy model promised a 78% cut, and the engine reproduces that figure exactly. The simulation adds what the toy model leaves out: merchants fail, and disputes keep arriving after they are gone. Four findings changed the design.</p>
<ol class="findings">
<li><b>Reserves insure against failure, not disputes.</b> Since a live merchant pays its own disputes, the right question is not “how much risk is left on this order” but “how much is uncovered if this merchant disappears today.” This reframes the guardrail around failing merchants.</li>
<li><b>Per-order release alone fails the guardrail.</b> Releasing delivered orders frees collateral that a failing merchant’s <i>undelivered</i> orders were relying on. Without a floor, loss rose against control in all twelve base and stress years.</li>
<li><b>Hold against what is unproven.</b> A floor of 30% of recent unproven volume restores loss parity at a ${pct(baseCut)} cut. Because it is defined on missing proof, it grows automatically when a merchant stops shipping, exactly when collateral matters most.</li>
<li><b>A dispute should raise a holdback, not spend it.</b> The PRD’s flow let a dispute draw down its order’s holdback. That drained collateral just as disputes spiked before a bust-out. The engine instead returns a disputed order to the flat schedule, consistent with PRD requirement 1.2.</li>
</ol>

<h2><span class="n">7</span>The prototype</h2>
<p>The engine, the backtest and a three-page product are built and covered by 47 automated tests, including tests that reproduce the PRD’s worked example to the cent. The Merchant View shows a new seller’s held money against today’s reserve, why it is held, and one-click actions that release it. The Admin View shows the same store to the risk team with the safety switch, and replays this paper’s simulation interactively (Figure 8). Of the PRD’s requirements, the holdback engine, shadow mode, proof inputs and Proof API, Thaw Meter, Advance, reason codes, appeals, audit log and kill switch are built. Usage proof runs in the engine and simulation. Closure mode, advance notice, Connect views and Sigma tables are not built.</p>
${fig(
  8,
  `<div class="shots"><img src="${shotMerchant}" alt="Merchant View"><img src="${shotSale}" alt="One-sale simulation"><img src="${shotYear}" alt="Year simulation"><img src="${shotAdmin}" alt="Stress test"></div>`,
  'The prototype. Top: the Merchant View, with money on hold against today’s reserve, three plain-language reasons and the tracking action that releases $2,618; and the merchant-facing simulation of one $1,000 sale. Bottom: the Admin View’s replay of the year across 300 stores, and its stress test, where each scenario in Table 2 can be selected.',
)}

<h2><span class="n">8</span>Economics</h2>
<p>Stripe cites roughly $1.9 trillion in annual volume [9] but does not publish the share under reserve, so sizing is a range (Table 5). Using the PRD’s middle case of 0.5% of volume held for an average of 120 days, about ${usdShort(econ.averageBalanceHeld)} of merchant money is held at any time, and a ${pct(baseCut)} cut returns about <b>${usdShort(econ.averageBalanceHeld * baseCut)}</b> to merchants. Thaw earns mainly through Advance fees: at 50% of held dollars advanced and a 2% fee, about ${usdShort(econ.advanceFees)} a year (illustrative). Offsetting costs are the expected loss and cost of funds on advances, priced from the same model, engineering and operations, and any float income Stripe currently earns on held funds, which only Finance can confirm. Two upsides are not counted: fewer hold-related support contacts, and fewer merchants moving volume elsewhere after a freeze.</p>
<p class="tcap"><b>Table 5.</b> Illustrative sizing (PRD assumptions: $1.9T volume, 120-day average hold).</p>
${table5}

<h2><span class="n">9</span>Limitations</h2>
<ul>
<li><b>Synthetic data.</b> Every rate, curve and failure pattern is a placeholder. The simulation assumes that evidence lowers dispute risk; real data has to show it, by category and by days since payment.</li>
<li><b>Outside the model:</b> card-network and bank-sponsor minimum reserves (hard floors in the engine), float income, operating cost, support volume and merchant sentiment.</li>
<li><b>Behavior:</b> merchants will add proof once it pays, and adversaries will adapt. Neither response is modeled beyond the fake-proof scenario.</li>
<li><b>Precision:</b> six seeds per scenario show direction and spread, not tight confidence intervals; some figures use one reference seed.</li>
</ul>

<h2><span class="n">10</span>Next steps</h2>
<p>The backtest harness consumes four tables per merchant: payments, proof events with the day each became known, disputes with arrival day and lost amount, and a failure date if the merchant closed. Replacing the synthetic generator with a loader for Stripe’s historical data runs the same ledgers, metrics, alerts and pre-registered cuts unchanged. That is the shadow mode the PRD asks for. If it holds, a pilot would randomize opted-in held merchants into Thaw or control at the account level, run until dispute counts can detect an agreed loss difference, and stop automatically if Thaw’s loss exceeds control by the margin. The first questions to answer are how reserve release is decided today, what share of volume is held, which minimums networks and sponsors impose, and what the dispute loss curve looks like by category.</p>

<h2>References</h2>
<div class="refs">
<p>[1] Trustpilot, Stripe reviews. trustpilot.com/review/stripe.com</p>
<p>[2] DirectPayNet, “Is Stripe safe?” (competitor-run). directpaynet.com</p>
<p>[3] WhatPayment, Stripe account frozen guide. whatpayment.com</p>
<p>[4] terms.law, Stripe holds and reserves FAQ. terms.law</p>
<p>[5] Merchant Cost Consulting, Stripe account frozen. merchantcostconsulting.com</p>
<p>[6] Merchant Maverick, Rolling reserve. merchantmaverick.com</p>
<p>[7] MyPayAdvisor, Capped versus rolling reserves. mypayadvisor.com</p>
<p>[8] PayPal Help, Release payments on hold. paypal.com</p>
<p>[9] Stripe, Dispute management and Smart Disputes. stripe.com/payments/dispute-management</p>
<p>[10] Stripe Docs, Dispute prevention. docs.stripe.com</p>
<p>[11] Chargeflow, What Stripe Smart Disputes covers. chargeflow.io</p>
<p>[12] Stripe Docs, How Capital works. docs.stripe.com/capital</p>
<p>[13] R. Rani, “PRD: Stripe Thaw,” Oct 4, 2026 (source of the toy model, requirements and sizing).</p>
</div>
<p class="small" style="margin-top:6pt">Sources checked on 2026-10-04; vendor and competitor sites are cited for sentiment and typical terms only. An independent concept built from public sources: not affiliated with Stripe, and no Stripe data was used.</p>
</body></html>`

mkdirSync(OUT, { recursive: true })
writeFileSync(`${OUT}/thaw-paper.html`, html)
const page = await browser.newPage()
await page.goto(`file://${resolve(OUT, 'thaw-paper.html')}`, { waitUntil: 'load' })
await page.evaluate(() => document.fonts.ready)
await page.pdf({
  path: `${OUT}/Thaw-Research-Paper.pdf`,
  format: 'Letter',
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: '<div></div>',
  footerTemplate: `<div style="font-family:'Helvetica Neue',Arial,sans-serif;font-size:7.5px;color:#6b7280;width:100%;padding:0 0.78in;display:flex;justify-content:space-between"><span>Thaw: Releasing Merchant Reserves on Evidence, Not the Calendar · Rayhan Rani</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
  margin: { top: '0.7in', bottom: '0.75in', left: '0.78in', right: '0.78in' },
})
await browser.close()
console.log(`Saved ${OUT}/Thaw-Research-Paper.pdf`)
