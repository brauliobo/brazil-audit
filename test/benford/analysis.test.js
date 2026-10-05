import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyze, deviationIndex, side } from '../../src/benford/analysis.js'
import { expected, mad } from '../../src/benford/stats.js'

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`)
const exact = (n) => expected('d1').map((p) => p * n) // counts that follow the law exactly
const band = (mean, lo, hi) => ({ mean, lo, hi })
const base = expected('d1').map((p) => band(p, p - 0.01, p + 0.01))
const around = (m, lo, hi) => ({ mad: band(m, m * lo, m * hi), chi2: band(1, 0, 2) }) // an envelope placed relative to a MAD value
const skewed = exact(10000).map((c, i) => (i === 0 ? c * 1.3 : c))
const skew = mad(skewed, expected('d1'))

test('a sample that follows the law has MAD zero, a close class and chi-square zero', () => {
  const r = analyze('d1', exact(100000), base, around(0.001, 0, 2))
  near(r.mad, 0)
  assert.equal(r.madClass, 'close')
  near(r.chi2, 0)
  assert.equal(r.verdict, 'inside') // MAD 0 is not below an envelope that starts at 0
})

test('the verdict follows the MAD against the simulated envelope', () => {
  assert.equal(analyze('d1', skewed, base, around(skew, 0.5, 0.9)).verdict, 'above')
  assert.equal(analyze('d1', skewed, base, around(skew, 1.1, 1.5)).verdict, 'below')
  assert.equal(analyze('d1', skewed, base, around(skew, 0.9, 1.1)).verdict, 'inside')
})

test('small samples and missing baselines are said so instead of being read', () => {
  const stat = around(skew, 0.9, 1.1)
  assert.equal(analyze('d1', exact(50), base, stat).verdict, 'small')
  assert.equal(analyze('d1', exact(10000), base, stat, 20000).verdict, 'small') // the minimum N is a parameter
  assert.equal(analyze('d1', Array(9).fill(0), base, stat).verdict, 'small')
  assert.equal(analyze('d1', exact(10000), null, null).verdict, 'nobase')
  assert.equal(analyze('d1', exact(109.5), base, stat).small, true) // d1 minimum N is 110
  assert.equal(analyze('d1', exact(110), base, stat).small, false)
})

test('places without a per-digit envelope still get the verdict from the MAD baseline', () => {
  const r = analyze('d1', skewed, null, { mad: band(skew * 0.5, skew * 0.4, skew * 0.9), chi2: band(1, 0, 2) })
  assert.equal(r.verdict, 'above')
  assert.equal(r.baseline.digits, null)
  near(r.index, 1.25) // (0.5 / 0.4) above the mean, in units of the upper half-width
  near(r.excess, 1) // twice the baseline mean MAD
})

test('digits outside the per-digit envelope are flagged with their direction', () => {
  const counts = exact(10000)
  counts[0] *= 1.2
  counts[8] *= 0.5
  const r = analyze('d1', counts, base, around(0.01, 0.5, 1.5))
  assert.equal(r.outside[0], 1)
  assert.equal(r.outside[8], -1)
  assert.equal(r.outside[3], 0)
})

test('deviation index: zero at the mean, one at the limits, signed', () => {
  const b = band(0.02, 0.015, 0.03)
  near(deviationIndex(0.02, b), 0)
  near(deviationIndex(0.03, b), 1)
  near(deviationIndex(0.015, b), -1)
  near(deviationIndex(0.04, b), 2)
  assert.equal(deviationIndex(0.02, band(0.02, 0.02, 0.02)), null)
  assert.equal(side(0.031, b), 'above')
  assert.equal(side(0.0149, b), 'below')
  assert.equal(side(0.02, b), 'inside')
})
