import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chiSquare, total } from '../../src/benford/stats.js'
import { binomial, hash, invert, modeOf, mulberry32, pmfAt } from '../../scripts/benford/rng.mjs'

const sample = (rng, n, p, draws) => Array.from({ length: draws }, () => binomial(rng, n, p))
const moments = (xs) => { const m = xs.reduce((t, x) => t + x, 0) / xs.length; return [m, xs.reduce((t, x) => t + (x - m) ** 2, 0) / xs.length] }

test('the generator is reproducible and uniform', () => {
  const [a, b] = [mulberry32(7), mulberry32(7)]
  assert.deepEqual([a(), a(), a()], [b(), b(), b()])
  const [m, v] = moments(Array.from({ length: 200000 }, mulberry32(1)))
  assert.ok(Math.abs(m - 0.5) < 0.005 && Math.abs(v - 1 / 12) < 0.003)
  assert.notEqual(hash('a|1'), hash('a|2'))
})

test('pmf values sum to one and the mode is the most likely outcome', () => {
  for (const [n, p] of [[10, 0.3], [300, 0.4], [600, 0.02]]) {
    const all = Array.from({ length: n + 1 }, (_, k) => pmfAt(n, k, p))
    assert.ok(Math.abs(all.reduce((t, x) => t + x, 0) - 1) < 1e-9)
    assert.equal(all.indexOf(Math.max(...all)), modeOf(n, p))
  }
})

test('exact inversion matches the binomial pmf (chi-square goodness of fit)', () => {
  const [n, p, draws] = [12, 0.3, 300000]
  const counts = Array(n + 1).fill(0)
  for (const x of sample(mulberry32(42), n, p, draws)) counts[x]++
  const { p: pValue } = chiSquare(counts, Array.from({ length: n + 1 }, (_, k) => pmfAt(n, k, p)))
  assert.ok(pValue > 0.001, `p = ${pValue}`)
  assert.equal(total(counts), draws)
})

test('moments of section-sized binomials, edge probabilities and the normal branch', () => {
  const [m, v] = moments(sample(mulberry32(3), 300, 0.4, 100000))
  assert.ok(Math.abs(m - 120) < 0.2 && Math.abs(v - 72) < 1.5)
  assert.equal(binomial(mulberry32(1), 50, 0), 0)
  assert.equal(binomial(mulberry32(1), 50, 1), 50)
  const [bm, bv] = moments(sample(mulberry32(5), 1e6, 0.3, 20000)) // variance 210000: normal approximation
  assert.ok(Math.abs(bm - 3e5) < 30 && Math.abs(bv / 210000 - 1) < 0.05)
  assert.equal(invert(5, 0.5, 2, pmfAt(5, 2, 0.5), 0.9999999999999), 5) // u in the far tail walks out to the end
})
