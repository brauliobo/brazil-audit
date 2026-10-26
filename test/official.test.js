import assert from 'node:assert/strict'
import test from 'node:test'
import { ELECTIONS } from '../src/elections.js'
import { officialEvent, officesOf } from '../scripts/official.mjs'

test('official events and offices belong to the selected round', () => {
  const first = ELECTIONS['2026']
  const second = ELECTIONS['2026-2']
  assert.deepEqual(officialEvent(first, 1), ['6257', 'c0001'])
  assert.deepEqual(officialEvent(second, 1), ['6258', 'c0001'])
  assert.deepEqual(officialEvent(second, 3), ['6260', 'c0003'])
  assert.deepEqual(officesOf(second, 'am'), [1, 3])
  assert.deepEqual(officesOf(second, 'sp'), [1])
  assert.deepEqual(officesOf(second, 'zz'), [1])
  assert.deepEqual(officesOf(first, 'df'), [1, 3, 5, 6, 8])
  assert.deepEqual(officesOf(first, 'sp'), [1, 3, 5, 6, 7])
})
