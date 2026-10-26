import assert from 'node:assert/strict'
import test from 'node:test'
import { tableDefinition } from '../scripts/table-schema.mjs'
import { turnoutRow, turnoutTargets, validateTurnout } from '../scripts/official-turnout.mjs'

const source = (te, installed, present, absent, scope = 'br') => ({ tpabr: { br: 'br', uf: 'uf', city: 'mu', zone: 'zona' }[scope], ele: '6258', t: '2', e: { te: String(te), esi: String(installed), esni: String(te - installed), est: String(te), esnt: '0', c: String(present), a: String(absent) }, s: { ts: '1', st: '1' }, dg: '25/10/2026', hg: '23:27:02' })
const el = { year: 2026, turn: 2, official: { events: { 1: 6258 } } }
test('official turnout preserves non-installed electorate and uses the installed denominator', () => {
  const row = turnoutRow(el, { scope: 'br', state: 'br', city: '', code: '', zone: '' }, source(158745502,158745079,128236074,30509005))
  assert.throws(() => turnoutRow(el, { scope: 'uf', state: 'ac' }, source(100,100,80,20)), /scope/)
  const missing = source(100,100,80,20)
  missing.e.a = null
  assert.throws(() => turnoutRow(el, { scope: 'br' }, missing), /missing electorate/)
  assert.equal(row.electorate - row.installed, 423)
  assert.equal(row.present + row.absent, row.installed)
  assert.equal((100 * row.absent / row.installed).toFixed(2), '19.22')
  assert.throws(() => turnoutRow(el, { scope: 'br' }, source(100,100,80,21)), /electorate/)
  assert.throws(() => turnoutRow(el, { scope: 'br' }, { ...source(100,100,80,20), t: '1' }), /election/)
})
test('target scopes preserve city-zone grain without double counting offices', () => {
  const targets = turnoutTargets({ abr: [{ cd: 'ac', mu: [{ cd: '01007', nm: 'BUJARI', z: ['0009'] }] }] })
  assert.deepEqual(targets.map((x) => x.scope), ['br','uf','city','zone'])
  assert.equal(new Set(targets.map((x) => [x.scope,x.state,x.code,x.zone].join('|'))).size, 4)
  const rows = targets.map((x) => turnoutRow(el, x, source(100,100,80,20,x.scope)))
  assert.equal(validateTurnout(rows).length, 0)
  rows[3].absent++
  assert.ok(validateTurnout(rows).some((s) => s.includes('zone')))
})

test('zero installed electorate remains zero rather than a fabricated abstention rate', () => {
  const row = turnoutRow(el, { scope: 'zone', state: 'ac', city: 'CITY', code: '00001', zone: '0001' }, source(10,0,0,0,'zone'))
  assert.equal(row.installed, 0)
  assert.equal(row.not_installed, 10)
  assert.equal(row.uncounted, 0)
})


test('rebuilding an expanded table refreshes COPY columns and DDL instead of retaining stale metadata', () => {
  const old = tableDefinition('turnout','installed bigint, present bigint')
  const current = tableDefinition('turnout','installed bigint, not_installed bigint, present bigint',old)
  assert.equal(current.columns,'election,turn,installed,not_installed,present')
  assert.match(current.ddl,/not_installed bigint/)
  assert.equal(old.columns,'election,turn,installed,present')
})
