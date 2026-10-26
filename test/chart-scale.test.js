import assert from 'node:assert/strict'
import test from 'node:test'
import { chartScale } from '../src/chart-scale.js'

test('logarithmic counts make late voting visible without changing counts or zero', () => {
  const { position, ticks } = chartScale(4_000_000, true)
  assert.equal(position(0), 0)
  assert.equal(position(4_000_000), 1)
  assert.ok(position(11) * 230 > 30)
  assert.ok(position(466) > position(11))
  assert.ok(position(30_268) > position(466))
  assert.deepEqual(ticks, [0, 10, 100, 1000, 10000, 100000, 1000000, 4000000])
})

test('linear charts retain proportional positions and evenly spaced ticks', () => {
  const { position, ticks } = chartScale(400)
  assert.equal(position(100), 0.25)
  assert.deepEqual(ticks, [0, 100, 200, 300, 400])
  for (const top of [0.1, 1, 2]) {
    const scale = chartScale(top, true)
    assert.equal(scale.position(top), 1)
    assert.equal(new Set(scale.ticks).size, scale.ticks.length)
    assert.ok(scale.ticks.every((v) => v >= 0 && v <= top))
  }
})
