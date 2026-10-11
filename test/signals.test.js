// npm test: the signal definitions (src/signals.js) and the shipped sg / sgf / sgz tables, which must agree with each other.
// Needs no database and no network.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { parseCsvLine } from '../scripts/csv.mjs'
import { CORE, HOURS, SIGNALS, bit, meanHour, others, signalsOf, toBrasilia, zScores } from '../src/signals.js'

const manifest = JSON.parse(readFileSync('data/manifest.json', 'utf8'))
const rowsOf = (table, id) => gunzipSync(readFileSync(`data/${manifest.tables[table].parts[id].url}`)).toString().trim().split('\n').map(parseCsvLine)

const city = (rates, name = 'a') => rates.map((p, i) => ({ state: 'xx', city: name, n: 1000, x: Math.round(1000 * p) + (i % 3) }))

test('a section far from its city has a large z and the others stay near zero', () => {
  const z = zScores([...city([0.2, 0.2, 0.21, 0.19, 0.2, 0.2, 0.2, 0.05])], 'x', 'n')
  assert.ok(z[7] < -3, `z of the outlier is ${z[7]}`)
  assert.ok(z.slice(0, 7).every((v) => Math.abs(v) < 3))
})

test('a small city is compared with its state, and rows without trials have no z', () => {
  const rows = [...city([0.2, 0.21, 0.19, 0.2, 0.2, 0.2], 'big'), ...city([0.2, 0.05], 'small'), { state: 'xx', city: 'small', n: 0, x: 0 }]
  const z = zScores(rows, 'x', 'n')
  assert.ok(z[7] < -3)
  assert.equal(z[8], null)
})

test('hourly counts are re-based to Brasilia time and the ends absorb the overflow', () => {
  const hours = Array.from({ length: HOURS }, (_, i) => i + 1)
  const out = toBrasilia(hours, 2)
  assert.equal(out.length, HOURS)
  assert.equal(out.reduce((a, b) => a + b, 0), hours.reduce((a, b) => a + b, 0))
  assert.deepEqual(out.slice(0, 2), [1 + 2 + 3, 4])
  assert.deepEqual(toBrasilia(hours, 0), hours)
  assert.equal(meanHour(Array(HOURS).fill(0)), null)
  assert.equal(meanHour(Object.assign(Array(HOURS).fill(0), { 3: 10 })), 8.5)
})

test('the ratio of the others of a school leaves the section out', () => {
  const rows = [{ s: 'a', x: 1, y: 10 }, { s: 'a', x: 3, y: 10 }, { s: 'b', x: 5, y: 10 }]
  assert.deepEqual(others(rows, (r) => r.s, (r) => [r.x, r.y]), [0.3, 0.1, null])
})

const hours = (late) => Object.assign(Array(HOURS).fill(0), { 5: 100 - late, 13: late })
const logged = { zabs: 0, aptos: 300, v: 100, lt: 20, zman: 0, man: 0, nor: 0, run: 0, znf: 0, comp: 100, dlate: 45, dnf: 0, hv: hours(20), hm: Array(HOURS).fill(0), hn: Array(HOURS).fill(0) }

test('the three core signals follow the documented limits', () => {
  assert.equal(signalsOf(logged) & CORE, bit('late'))
  assert.equal(signalsOf({ ...logged, lt: 5, hv: hours(5) }), 0)
  assert.equal(signalsOf({ ...logged, dlate: 10 }) & bit('late'), 0, 'not later than the rest of the school')
  assert.equal(signalsOf({ ...logged, dlate: null }) & bit('late'), bit('late'), 'a school with one section has nobody to compare with')
  assert.equal(signalsOf({ ...logged, lt: 0, zabs: -3.1 }) & CORE, bit('abstention'))
  assert.equal(signalsOf({ ...logged, lt: 0, zabs: -3.1, aptos: 40 }) & CORE, 0, 'fewer than 50 voters on the roll')
  assert.equal(signalsOf({ ...logged, lt: 0, zman: 3.5, man: 6 }) & CORE, bit('manual'))
  assert.deepEqual(SIGNALS.slice(0, 3), ['abstention', 'late', 'manual'])
  assert.equal(CORE, bit('abstention') | bit('late') | bit('manual'))
})

test('sections without a log only have the abstention signal', () => {
  assert.equal(signalsOf({ zabs: -4, aptos: 200, v: null }), bit('abstention'))
  assert.equal(signalsOf({ zabs: 0, aptos: 200, v: null }), 0)
})

test('sgf holds exactly the sections of sg with a core signal, and sgz adds up sg', () => {
  const keys = Object.keys(manifest.tables.sgf?.parts ?? {})
  assert.ok(keys.length > 0, 'run the build with --only=signals first')
  for (const id of keys) {
    const key = id.split('/')[0]
    const sg = Object.keys(manifest.tables.sg.parts).filter((p) => p.startsWith(`${key}/`)).flatMap((p) => rowsOf('sg', p))
    const [aptos, fl] = [(r) => +r[7], (r) => +r[23]] // election, turn, state, city, zone, section, school, aptos ... fl
    assert.equal(rowsOf('sgf', id).length, sg.filter((r) => fl(r) & CORE).length, key)
    const zones = rowsOf('sgz', `${key}/all`)
    assert.equal(zones.reduce((n, r) => n + +r[5], 0), sg.length, `${key} sections`)
    assert.equal(zones.reduce((n, r) => n + +r[6], 0), sg.reduce((n, r) => n + aptos(r), 0), `${key} voters`)
  }
})

test('pace signals need a regular voting: 60 votes, a median of 45 s or less or a pause of 2 h or more', () => {
  const r = { zabs: 0, aptos: 300, v: 100, hv: Array(15).fill(0), hm: Array(15).fill(0), hn: Array(15).fill(0), lt: 0, run: 0 }
  assert.equal(signalsOf({ ...r, med: 45, gap: 600 }) & (bit('fast') | bit('idle')), bit('fast'))
  assert.equal(signalsOf({ ...r, med: 100, gap: 7200 }) & (bit('fast') | bit('idle')), bit('idle'))
  assert.equal(signalsOf({ ...r, v: 59, med: 10, gap: 9000 }) & (bit('fast') | bit('idle')), 0)
  assert.equal(signalsOf({ ...r, med: null, gap: null }) & (bit('fast') | bit('idle')), 0)
})

test('the pace of sg is the one of vt, and the log votes agree with its events (one table of times for both views)', () => {
  const parts = Object.keys(manifest.tables.sg.parts).filter((id) => manifest.tables.vt.parts[id])
  assert.ok(parts.length > 0, 'no election with logs in sg')
  let checked = 0
  for (const id of parts) {
    const vt = new Map(rowsOf('vt', id).map((r) => [r.slice(2, 6).join('|'), r]))
    const logged = rowsOf('sg', id).filter((r) => r[10] !== '' && vt.has(r.slice(2, 6).join('|')))
    if (!logged.length) continue // a UF whose logs are not part of the release
    checked++
    for (const r of logged) {
      const v = vt.get(r.slice(2, 6).join('|'))
      assert.deepEqual([r[24], r[25]], [v[10], v[13]], `${id} ${r.slice(2, 6)}`)
    }
    const close = logged.filter((r) => Math.abs(+r[10] - +vt.get(r.slice(2, 6).join('|'))[7]) <= 2).length
    assert.ok(close / logged.length > 0.98, `${id}: only ${close} of ${logged.length} sections have the same number of votes as vt`)
  }
  assert.ok(checked > 0, 'no section with a log')
})
