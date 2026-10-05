// Combines the observed counts, the simulated baseline and the statistics of stats.js into one reading of a scope.
import { DIGITS, chiSquare, expected, mad, madClass, madNoise, minSample, total, zScores } from './stats.js'

/** `digits` query parameter -> position of the shipped tables. */
export const POS_OF = { 1: 'd1', 2: 'd2', 12: 'd12', last: 'd_last' }
export const DIGITS_PARAM = Object.fromEntries(Object.entries(POS_OF).map(([k, v]) => [v, k]))

/**
 * How far the observed MAD is from the baseline: 0 at the baseline mean, +-1 at its 97.5% / 2.5% limit (beyond that the
 * observed MAD is outside the simulated envelope). Null without a baseline or when the envelope has no width.
 */
export function deviationIndex(value, { mean, lo, hi }) {
  const width = value >= mean ? hi - mean : mean - lo
  return width > 0 ? (value >= mean ? 1 : -1) * Math.abs(value - mean) / width : null
}

/** 'inside' | 'above' | 'below' the simulated envelope of the MAD. */
export const side = (value, { lo, hi }) => (value > hi ? 'above' : value < lo ? 'below' : 'inside')

/**
 * pos: d1 | d2 | d12 | d_last; counts: observed count per digit; base: [{ mean, lo, hi }] per digit (proportions) or null;
 * stat: { mad, chi2 } of the baseline ({ mean, lo, hi } each) or null; minN: below it the scope is a small sample.
 * The verdict only needs `stat` (places listed on a map or in a ranking carry no per-digit envelope).
 */
export function analyze(pos, counts, base, stat, minN = minSample(pos)) {
  const probs = expected(pos)
  const n = total(counts)
  const base_ = stat ? { digits: base, mad: stat.mad, chi2: stat.chi2 } : null
  if (!n) return { pos, digits: DIGITS[pos], n, probs, counts, small: true, minN, baseline: base_, verdict: 'small' }
  const props = counts.map((c) => c / n)
  const madValue = mad(counts, probs)
  const test = chiSquare(counts, probs)
  const outside = props.map((p, i) => (base ? (p > base[i].hi ? 1 : p < base[i].lo ? -1 : 0) : 0))
  const small = n < minN
  const verdict = small ? 'small' : !base_ ? 'nobase' : side(madValue, stat.mad)
  return {
    pos, digits: DIGITS[pos], n, probs, counts, props, small, minN, baseline: base_, outside, verdict,
    mad: madValue, madClass: madClass(pos, madValue), noise: madNoise(probs, n), chi2: test.chi2, df: test.df, p: test.p,
    z: zScores(counts, probs), index: base_ ? deviationIndex(madValue, stat.mad) : null, // excess: observed MAD relative to the baseline mean, an effect size that (unlike the index) does not grow with N
    excess: base_ && stat.mad.mean > 0 ? madValue / stat.mad.mean - 1 : null,
  }
}
