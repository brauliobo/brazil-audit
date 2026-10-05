// Dependency-free digit statistics: expected distributions, chi-square (exact p-value), Nigrini's MAD, per-digit z, envelopes.
// A "position" is one of d1 (first digit 1-9), d2 (second digit 0-9), d12 (first two digits 10-99), d_last (last digit 0-9).

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i)
const log10 = Math.log10

export const POSITIONS = ['d1', 'd2', 'd12', 'd_last']
export const DIGITS = { d1: range(1, 9), d2: range(0, 9), d12: range(10, 99), d_last: range(0, 9) }

const second = (d) => range(1, 9).reduce((t, k) => t + log10(1 + 1 / (10 * k + d)), 0)
const EXPECT = {
  d1: (d) => log10(1 + 1 / d),
  d2: second,
  d12: (d) => log10(1 + 1 / d),
  d_last: () => 0.1,
}

/** Expected probabilities of the digits of `pos`, in the order of DIGITS[pos]. */
export const expected = (pos) => DIGITS[pos].map(EXPECT[pos])

/** The digit of `pos` of a positive integer count, or null when the count does not have it (second digit needs 2+ digits). */
export function digitOf(pos, value) {
  const s = String(value)
  if (value <= 0) return null
  if (pos === 'd1') return +s[0]
  if (pos === 'd_last') return +s.at(-1)
  return s.length < 2 ? null : pos === 'd2' ? +s[1] : +s.slice(0, 2)
}

/** Counts of the digits of `pos` over `values`, in the order of DIGITS[pos]. */
export function histogram(pos, values) {
  const first = DIGITS[pos][0]
  const counts = Array(DIGITS[pos].length).fill(0)
  for (const v of values) { const d = digitOf(pos, v); if (d != null) counts[d - first]++ }
  return counts
}

export const total = (counts) => counts.reduce((t, c) => t + c, 0)

// ---- chi-square -------------------------------------------------------------------------------------------------------

const LANCZOS = [676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7]

/** ln Gamma(x) for x > 0 (Lanczos, g = 7). */
export function lnGamma(x) {
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x)
  const y = x - 1
  const t = y + 7.5
  const a = LANCZOS.reduce((s, c, i) => s + c / (y + i + 1), 0.99999999999980993)
  return 0.5 * Math.log(2 * Math.PI) + (y + 0.5) * Math.log(t) - t + Math.log(a)
}

/** Regularized upper incomplete gamma Q(a, x): series for x < a + 1, Lentz continued fraction otherwise. */
export function gammaQ(a, x) {
  if (x <= 0) return 1
  const front = Math.exp(-x + a * Math.log(x) - lnGamma(a))
  if (x < a + 1) {
    let [term, sum, n] = [1 / a, 1 / a, a]
    while (Math.abs(term) > Math.abs(sum) * 1e-16) { n++; term *= x / n; sum += term }
    return 1 - sum * front
  }
  const tiny = 1e-300
  let [b, c, d] = [x + 1 - a, 1 / tiny, 1 / (x + 1 - a)]
  let h = d
  for (let i = 1; i < 10000; i++) {
    const an = -i * (i - a)
    b += 2
    d = an * d + b; d = Math.abs(d) < tiny ? tiny : d
    c = b + an / c; c = Math.abs(c) < tiny ? tiny : c
    d = 1 / d
    const delta = d * c
    h *= delta
    if (Math.abs(delta - 1) < 1e-16) break
  }
  return front * h
}

/** Survival function of the chi-square distribution: P(X >= x) with `df` degrees of freedom. */
export const chiSquareSf = (x, df) => gammaQ(df / 2, x / 2)

/** Pearson chi-square of observed counts against probabilities. */
export function chiSquare(counts, probs) {
  const n = total(counts)
  const chi2 = counts.reduce((t, o, i) => t + (o - n * probs[i]) ** 2 / (n * probs[i]), 0)
  const df = counts.length - 1
  return { n, chi2, df, p: n ? chiSquareSf(chi2, df) : null }
}

// ---- MAD (Nigrini) ----------------------------------------------------------------------------------------------------

/** Mean absolute deviation between observed proportions and the expected probabilities. */
export function mad(counts, probs) {
  const n = total(counts)
  return counts.reduce((t, o, i) => t + Math.abs(o / n - probs[i]), 0) / counts.length
}

/** Upper bounds of the classes close / acceptable / marginal (above the last: nonconformity); d_last has no published scale. */
export const MAD_LIMITS = { d1: [0.006, 0.012, 0.015], d2: [0.008, 0.01, 0.012], d12: [0.0012, 0.0018, 0.0022] }
export const MAD_CLASSES = ['close', 'acceptable', 'marginal', 'nonconformity']

export function madClass(pos, value) {
  const limits = MAD_LIMITS[pos]
  if (!limits) return null
  const i = limits.findIndex((l) => value <= l)
  return MAD_CLASSES[i < 0 ? 3 : i]
}

/** Expected MAD of a sample of size n that follows the law exactly (normal approximation of each cell): the noise floor of MAD. */
export const madNoise = (probs, n) => probs.reduce((t, p) => t + Math.sqrt((2 * p * (1 - p)) / (Math.PI * n)), 0) / probs.length

/** Smallest n at which the rarest digit is expected at least 5 times, the usual validity rule of the chi-square approximation. */
export const minSample = (pos) => Math.ceil(5 / Math.min(...expected(pos)))

// ---- per-digit z and bands --------------------------------------------------------------------------------------------

/** Signed z of every digit with Nigrini's continuity correction (1 / 2n), and the 95% band of each proportion. */
export function zScores(counts, probs) {
  const n = total(counts)
  return counts.map((o, i) => {
    const p = probs[i]
    const diff = o / n - p
    const se = Math.sqrt((p * (1 - p)) / n)
    const z = Math.sign(diff) * Math.max(Math.abs(diff) - 1 / (2 * n), 0) / se
    return { z, lo: Math.max(p - 1.96 * se - 1 / (2 * n), 0), hi: p + 1.96 * se + 1 / (2 * n) }
  })
}

// ---- simulated baseline -----------------------------------------------------------------------------------------------

/** Empirical quantile (linear interpolation) of an ascending-sorted array. */
export function quantile(sorted, q) {
  const at = (sorted.length - 1) * q
  const i = Math.floor(at)
  return sorted[i] + (sorted[Math.min(i + 1, sorted.length - 1)] - sorted[i]) * (at - i)
}

/** Digit-wise mean and 2.5% / 97.5% envelope of replicated histograms (reps[r][digit]). */
export function envelope(reps) {
  return reps[0].map((_, i) => {
    const col = reps.map((r) => r[i]).sort((a, b) => a - b)
    return { mean: col.reduce((t, v) => t + v, 0) / col.length, lo: quantile(col, 0.025), hi: quantile(col, 0.975) }
  })
}
