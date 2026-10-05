// Regression check for the election order: src/elections.js lists elections chronologically (year, then round), the default election
// is the latest one, links without an election resolve to it, and no code takes the order from the keys of the ELECTIONS object (a JS
// object lists integer-like keys such as '2026' before '2022-2', which once made 2022-2 the default).
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_ELECTION, ELECTIONS, ELECTION_LIST, SEATS_ELECTION } from '../src/model.js'
import { parseRoute } from '../src/routes.js'

const chronological = [...ELECTION_LIST].sort((a, b) => a.year - b.year || a.turn - b.turn)
assert.deepEqual(ELECTION_LIST.map((e) => e.key), chronological.map((e) => e.key), 'ELECTION_LIST must be chronological')
for (const e of ELECTION_LIST) assert.equal(e.key, e.turn === 1 ? `${e.year}` : `${e.year}-${e.turn}`, `key of ${e.key}`)
assert.equal(new Set(ELECTION_LIST.map((e) => e.key)).size, ELECTION_LIST.length, 'duplicate election keys')
assert.deepEqual(Object.keys(ELECTIONS).sort(), ELECTION_LIST.map((e) => e.key).sort(), 'ELECTIONS and ELECTION_LIST differ')

const latest = chronological.at(-1).key
assert.equal(DEFAULT_ELECTION, latest, 'DEFAULT_ELECTION must be the latest election')
assert.equal(SEATS_ELECTION, chronological.findLast((e) => e.hasSeats).key, 'SEATS_ELECTION must be the latest election with seats')

const BASE = '/brazil-audit/'
for (const path of ['', 'overview', 'maps', 'time/sp', 'drill/sp/SÃO%20PAULO']) {
  const r = parseRoute(BASE, `${BASE}${path}`, '')
  assert.equal(r.election, latest, `/${path} must open the latest election`)
  assert.equal(r.notFound, false, `/${path} must not be not-found`)
}
for (const key of Object.keys(ELECTIONS)) assert.equal(parseRoute(BASE, `${BASE}${key}/maps`, '').election, key, `/${key}/maps`)
for (const path of ['2027/overview', '2022-3/overview', '1999', 'foo']) assert.equal(parseRoute(BASE, `${BASE}${path}`, '').notFound, true, `/${path} must be not-found`)

const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]))
const orderFromKeys = walk('src').filter((f) => /\.(js|vue)$/.test(f) && !f.endsWith('elections.js')).filter((f) => /Object\.(keys|values|entries)\(ELECTIONS\)/.test(readFileSync(f, 'utf8')))
assert.deepEqual(orderFromKeys, [], `use ELECTION_LIST, not the key order of ELECTIONS: ${orderFromKeys.join(', ')}`)
console.log(`elections: ${ELECTION_LIST.length} in chronological order, default ${DEFAULT_ELECTION}, fallbacks and not-found routes ok`)
