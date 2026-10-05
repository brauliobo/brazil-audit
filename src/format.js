// The one place that formats numbers for display, in the active language (1.234,5 in pt-BR, 1,234.5 in en).
import { locale } from './i18n'

const cache = new Map()
const nf = (options = {}) => {
  const key = `${locale.value}${JSON.stringify(options)}`
  if (!cache.has(key)) cache.set(key, new Intl.NumberFormat(locale.value, options))
  return cache.get(key)
}
const digits = (d) => ({ minimumFractionDigits: d, maximumFractionDigits: d })
const NONE = '–'

export const int = (n) => (n == null ? NONE : nf().format(Math.round(n)))
export const num = (n, d = 2) => (n == null ? NONE : nf(digits(d)).format(n))
export const pct = (x, d = 2) => (x == null ? NONE : nf({ style: 'percent', ...digits(d) }).format(x))
export const signed = (n, d = 0) => nf({ signDisplay: 'always', ...digits(d) }).format(n)
export const signedPct = (x, d = 2) => nf({ style: 'percent', signDisplay: 'always', ...digits(d) }).format(x)
/** Any number as the SQL console shows it: up to 6 decimals, no thousands separator on 4-digit values (years, codes). */
export const cell = (n) => nf({ maximumFractionDigits: 6, useGrouping: 'min2' }).format(n)
export const ms = (t) => (t < 10 ? `${num(t, 1)} ms` : t < 1000 ? `${int(t)} ms` : `${num(t / 1000, 2)} s`)
export const bytes = (n) => (n < 1024 ** 2 ? `${int(n / 1024)} KB` : `${num(n / 1024 ** 2, 1)} MB`)
export const clock = (sec) => `${String(Math.floor(sec / 3600) % 24).padStart(2, '0')}:${String(Math.floor(sec / 60) % 60).padStart(2, '0')}`
