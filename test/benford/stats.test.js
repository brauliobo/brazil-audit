import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DIGITS, chiSquare, chiSquareSf, digitOf, envelope, expected, histogram, lnGamma, mad, madClass, madNoise, minSample, quantile, zScores } from '../../src/benford/stats.js'

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b} (eps ${eps})`)

test('expected distributions sum to one and match the known values', () => {
  for (const pos of Object.keys(DIGITS)) near(expected(pos).reduce((t, p) => t + p, 0), 1, 1e-12)
  near(expected('d1')[0], Math.log10(2))
  near(expected('d1')[8], Math.log10(10 / 9))
  near(expected('d12')[0], Math.log10(1.1))
  // second digit, Nigrini's table to 4 decimals
  ;[0.1197, 0.1139, 0.1088, 0.1043, 0.1003, 0.0967, 0.0934, 0.0904, 0.0876, 0.085].forEach((p, i) => near(expected('d2')[i], p, 5e-5))
  assert.ok(expected('d_last').every((p) => p === 0.1))
})

test('digit extraction: second digit needs two digits, zeros are excluded', () => {
  assert.equal(digitOf('d1', 907), 9)
  assert.equal(digitOf('d2', 907), 0)
  assert.equal(digitOf('d2', 7), null)
  assert.equal(digitOf('d2', 10), 0)
  assert.equal(digitOf('d12', 1234), 12)
  assert.equal(digitOf('d_last', 120), 0)
  assert.equal(digitOf('d1', 0), null)
  assert.deepEqual(histogram('d1', [1, 12, 19, 200, 0, 9]), [3, 1, 0, 0, 0, 0, 0, 0, 1])
  assert.deepEqual(histogram('d2', [5, 10, 21, 33, 34]).slice(0, 5), [1, 1, 0, 1, 1])
})

test('lnGamma matches factorials and the half-integer value', () => {
  near(lnGamma(5), Math.log(24), 1e-12)
  near(lnGamma(0.5), Math.log(Math.sqrt(Math.PI)), 1e-12)
  near(lnGamma(30), Math.log(8841761993739701954543616000000), 1e-9)
})

test('chi-square survival function: closed forms and tabulated critical values', () => {
  near(chiSquareSf(0, 5), 1)
  near(chiSquareSf(2, 2), Math.exp(-1), 1e-14)
  near(chiSquareSf(6, 4), Math.exp(-3) * 4, 1e-14) // df 4: exp(-x/2) (1 + x/2)
  near(chiSquareSf(3.841458820694124, 1), 0.05, 1e-12)
  near(chiSquareSf(15.507313055865453, 8), 0.05, 1e-12)
  near(chiSquareSf(16.918977604620448, 9), 0.05, 1e-12)
  near(chiSquareSf(0.5, 3), 0.9188914116546758, 1e-12) // scipy
  near(chiSquareSf(25, 10) / 0.005345505487134069, 1, 1e-10)
  near(chiSquareSf(100, 8) / 4.269159205144943e-18, 1, 1e-9) // far tail keeps its relative precision
})

test('chi-square of a hand-computed table', () => {
  const r = chiSquare([10, 20], [0.5, 0.5]) // expected 15 each: (25 + 25) / 15
  near(r.chi2, 10 / 3)
  assert.equal(r.df, 1)
  near(r.p, 0.06788915486182909, 1e-12)
  near(chiSquare([30, 18, 12, 9, 8, 7, 6, 5, 5], expected('d1')).n, 100)
})

test('MAD and its conformity classes', () => {
  near(mad([50, 50], [0.4, 0.6]), 0.1)
  near(mad([30, 70], [0.3, 0.7]), 0)
  assert.equal(madClass('d1', 0.006), 'close')
  assert.equal(madClass('d1', 0.0061), 'acceptable')
  assert.equal(madClass('d1', 0.012), 'acceptable')
  assert.equal(madClass('d1', 0.015), 'marginal')
  assert.equal(madClass('d1', 0.0151), 'nonconformity')
  assert.equal(madClass('d2', 0.0099), 'acceptable')
  assert.equal(madClass('d12', 0.0023), 'nonconformity')
  assert.equal(madClass('d_last', 0.5), null)
})

test('noise floor of MAD shrinks with n and the minimum sample follows the expected-5 rule', () => {
  const p = expected('d1')
  assert.ok(madNoise(p, 100) > madNoise(p, 10000))
  near(madNoise(p, 10000) * 100, madNoise(p, 1000000) * 1000, 1e-12) // 1 / sqrt(n)
  assert.deepEqual(['d1', 'd2', 'd12', 'd_last'].map(minSample), [110, 59, 1146, 50])
})

test('z with continuity correction and the 95% band, by hand', () => {
  // n = 100, observed 40 where 30 is expected: diff .1, se sqrt(.3 * .7 / 100), correction 1 / 200
  const [r] = zScores([40, 60], [0.3, 0.7])
  const se = Math.sqrt(0.21 / 100)
  near(r.z, (0.1 - 0.005) / se)
  near(r.lo, 0.3 - 1.96 * se - 0.005)
  near(r.hi, 0.3 + 1.96 * se + 0.005)
  assert.equal(zScores([30, 70], [0.3, 0.7])[0].z, 0) // inside the correction: no deviation
  assert.ok(zScores([20, 80], [0.3, 0.7])[0].z < 0)
})

test('quantile interpolates and the envelope is taken digit by digit', () => {
  near(quantile([0, 10], 0.25), 2.5)
  near(quantile([1, 2, 3, 4, 5], 0.5), 3)
  const reps = Array.from({ length: 101 }, (_, r) => [r, 100 - r])
  const [a, b] = envelope(reps)
  near(a.mean, 50)
  near(a.lo, 2.5)
  near(a.hi, 97.5)
  near(b.lo, 2.5)
})
