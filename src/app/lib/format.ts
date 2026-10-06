import type { Cents } from '../../engine'
import { dayToDate } from '../demo/merchant'

const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const usd2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })

/** Cents to dollars: "$1,234" (or "$12.34" with cents). */
export function money(cents: Cents, opts: { cents?: boolean } = {}): string {
  return (opts.cents ? usd2 : usd0).format(cents / 100)
}

/** Whole dollars, compact: $95M, $3.1B, $625M. */
export function compactUsd(dollars: number): string {
  const abs = Math.abs(dollars)
  const sign = dollars < 0 ? '−' : ''
  if (abs >= 1e12) return `${sign}$${trim(abs / 1e12)}T`
  if (abs >= 1e9) return `${sign}$${trim(abs / 1e9)}B`
  if (abs >= 1e6) return `${sign}$${trim(abs / 1e6)}M`
  if (abs >= 1e3) return `${sign}$${trim(abs / 1e3)}K`
  return `${sign}$${Math.round(abs)}`
}

function trim(x: number): string {
  return x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1).replace(/\.0$/, '') : x.toFixed(2).replace(/0$/, '').replace(/\.0$/, '')
}

export function pct(x: number, digits = 0): string {
  return `${(x * 100).toFixed(digits)}%`
}

/** A range of shares as "48–51%". */
export function pctRange(a: number, b: number): string {
  const lo = Math.round(a * 100)
  const hi = Math.round(b * 100)
  return lo === hi ? `${lo}%` : `${lo}–${hi}%`
}

export function num(x: number, digits = 0): string {
  return x.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export function bps(x: number): string {
  return `${x.toFixed(2)} bps`
}

const shortDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })
const longDate = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })

export function dayLabel(day: number): string {
  return shortDate.format(dayToDate(day))
}

export function dayLong(day: number): string {
  return longDate.format(dayToDate(day))
}

export function dateLabel(d: Date): string {
  return longDate.format(d)
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${num(n)} ${n === 1 ? one : many}`
}
