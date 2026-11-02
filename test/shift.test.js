import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { unitsSql, votesSql, candidatesSql, grainOf, roundsOf, DEPTH } from '../src/contest.js'
import { childrenOf, citiesOf, contestsOf, finalistsOf, governorsOf, linkedTo, placesOf, pools, rosterOf, shiftOf, totalOf, transfersOf, unitsOf } from '../src/shift.js'
import { ELECTIONS, installElectionRegistry, firstRoundOf, shiftOffices, supportsView } from '../src/election-registry.js'

const manifest = JSON.parse(readFileSync('data/manifest.json', 'utf8'))
installElectionRegistry(JSON.parse(readFileSync('data/elections.json', 'utf8')))
const insert = (db, table, rows) => Promise.all(rows.map((r) => db.query(`insert into ${table} (${Object.keys(r).join(',')}) values (${Object.keys(r).map((_, i) => `$${i + 1}`).join(',')})`, Object.values(r))))

// One presidential contest in two states: round 1 (event r1) and the runoff (event r2), at the zone grain, like the canonical tables.
const rounds = { firstIds: ['r1'], secondIds: ['r2'], first: '2000', second: '2000-2' }
async function fixture() {
  const db = new PGlite()
  for (const t of ['election_units', 'election_votes', 'election_candidates', 'endorsement', 'spectrum']) await db.exec(manifest.tables[t].ddl)
  const unit = (id, state, city, zone, eligible, present, blank, nul, nominal) => ({ election_id: id, grain: 'zone', state, city_code: city, zone, office_key: 'president', eligible, present, blank, null_votes: nul, nominal, transit: 'N' })
  await insert(db, 'election_units', [
    unit('r1', 'aa', '001', '0001', 1000, 800, 20, 30, 750), unit('r1', 'aa', '001', '0002', 500, 400, 10, 10, 380), unit('r1', 'bb', '002', '0001', 600, 500, 5, 15, 480),
    unit('r2', 'aa', '001', '0001', 1010, 900, 10, 20, 870), unit('r2', 'aa', '001', '0002', 500, 450, 5, 5, 440), unit('r2', 'bb', '002', '0001', 600, 540, 10, 10, 520),
    { ...unit('r1', 'aa', '001', '0003', 99, 99, 0, 0, 99), transit: 'S' },
  ])
  const vote = (id, state, city, zone, number, votes) => ({ election_id: id, grain: 'zone', state, city_code: city, zone, office_key: 'president', candidate_id: `c${number}`, kind: 'candidate', number, votes, transit: 'N' })
  await insert(db, 'election_votes', [
    vote('r1', 'aa', '001', '0001', '13', 300), vote('r1', 'aa', '001', '0001', '22', 250), vote('r1', 'aa', '001', '0001', '70', 120), vote('r1', 'aa', '001', '0001', '14', 80),
    vote('r1', 'aa', '001', '0002', '13', 100), vote('r1', 'aa', '001', '0002', '22', 200), vote('r1', 'aa', '001', '0002', '70', 50), vote('r1', 'aa', '001', '0002', '14', 30),
    vote('r1', 'bb', '002', '0001', '13', 250), vote('r1', 'bb', '002', '0001', '22', 150), vote('r1', 'bb', '002', '0001', '70', 40), vote('r1', 'bb', '002', '0001', '14', 40),
    vote('r2', 'aa', '001', '0001', '13', 470), vote('r2', 'aa', '001', '0001', '22', 400), vote('r2', 'aa', '001', '0002', '13', 160), vote('r2', 'aa', '001', '0002', '22', 280),
    vote('r2', 'bb', '002', '0001', '13', 340), vote('r2', 'bb', '002', '0001', '22', 180), { ...vote('r1', 'aa', '001', '0003', '13', 99), transit: 'S' },
  ])
  await insert(db, 'election_candidates', [['13', 'LULA', 'PT'], ['22', 'JAIR', 'PL'], ['70', 'CURY', 'AVANTE'], ['14', 'RENAN', 'MISSAO']].map(([number, name, party]) => ({ election_id: 'r1', office_key: 'president', candidate_id: `c${number}`, number, name, short_name: name, party, state: 'aa' })))
  await insert(db, 'endorsement', [{ election: 2000, turn: 2, n: '70', to_n: '22', source: 'test' }])
  await insert(db, 'spectrum', [['PT', 1994, 2026, 'E'], ['PL', 1994, 2026, 'D'], ['AVANTE', 1994, 2026, 'C']].map(([party, from_year, to_year, bloc]) => ({ party, from_year, to_year, bloc })))
  return db
}
const load = async (db, q) => (await db.query(q.sql, q.params)).rows

async function data(db, state = null) {
  const [rows, votes] = [await load(db, unitsSql(rounds, 'president', 'zone', state)), await load(db, votesSql(rounds, 'president', 'zone', state))]
  const [a, b] = finalistsOf(votes)
  return { rows, votes, a, b, places: placesOf(rows, votes, a, b) }
}

test('the units and votes of both rounds come from the canonical tables, leave out the zones in transit and give the finalists', async () => {
  const db = await fixture()
  const { rows, votes, a, b, places } = await data(db)
  assert.equal(rows.length, 6)
  assert.deepEqual([a, b], ['13', '22'])
  assert.equal(places.length, 3)
  assert.equal(votes.filter((v) => v.number === '13' && v.turn === 1).length, 3)
  assert.equal((await data(db, 'bb')).places.length, 1)
  const cands = await load(db, candidatesSql(rounds, 'president', null))
  assert.deepEqual(cands.map((c) => c.number), ['13', '14', '22', '70'])
  assert.deepEqual((await load(db, candidatesSql(rounds, 'governor', null))).length, 0)
})

test('the identity holds for the zones of a municipality, the municipalities of a state and the states of the country', async () => {
  const db = await fixture()
  const { places } = await data(db)
  for (const args of [[], ['aa'], ['aa', '001'], ['aa', '001', '0001']]) {
    const found = childrenOf(places, args)
    assert.ok(found.length > 0, `children of ${args.join('/') || 'country'}`)
    for (const r of found) assert.equal(r.gap, 0, `${args.join('/')} ${r.k}`)
  }
  assert.deepEqual(childrenOf(places, []).map((r) => r.k).sort(), ['aa', 'bb'])
  assert.deepEqual(childrenOf(places, ['aa']).map((r) => r.k), ['001'])
  assert.deepEqual(childrenOf(places, ['aa', '001']).map((r) => r.k).sort(), ['0001', '0002'])
  const [zone] = childrenOf(places, ['aa', '001']).filter((r) => r.k === '0001')
  assert.deepEqual([zone.d.a, zone.d.b, zone.others1, zone.d.nu, zone.d.bl, zone.d.abs, zone.d.ap, zone.result], [170, 150, 200, -10, -10, -90, 10, 320])
  const country = totalOf(childrenOf(places, []))
  assert.equal(country.a2, 470 + 160 + 340)
  assert.deepEqual(pools(country).map((p) => p.id), ['others', 'nu', 'bl', 'abs', 'ap'])
})

test('a place turns when the finalists swap and a municipality adds its zones', async () => {
  const db = await fixture()
  const { places } = await data(db)
  const cities = citiesOf(places)
  assert.deepEqual(cities.map((r) => [r.city, r.turned]).sort(), [['001', false], ['002', false]])
  assert.equal(cities.find((r) => r.city === '001').a2, 630)
  assert.equal(shiftOf({ a1: 10, b1: 20, a2: 30, b2: 20, nom1: 30, nom2: 50, bl1: 0, bl2: 0, nu1: 0, nu2: 0, ap1: 50, ap2: 50, co1: 30, co2: 50 }).turned, true)
})

test('the contests are the country for a president, a state for a governor and a municipality for a mayor', async () => {
  const db = await fixture()
  const { rows, votes } = await data(db)
  assert.deepEqual(contestsOf(rows, votes, DEPTH.president).map((c) => [c.key, c.a, c.b]), [['', '13', '22']])
  assert.deepEqual(contestsOf(rows, votes, DEPTH.governor).map((c) => c.key).sort(), ['aa', 'bb'])
  assert.deepEqual(contestsOf(rows, votes, DEPTH.mayor).map((c) => c.key).sort(), ['aa|001', 'bb|002'])
})

test('the roster has the declared support and the bloc of each party, and too few places give no estimate', async () => {
  const db = await fixture()
  const { places, a, b } = await data(db)
  const spectrum = await load(db, { sql: 'select * from spectrum', params: [] })
  const candidates = await load(db, candidatesSql(rounds, 'president', null))
  const endorsements = await load(db, { sql: 'select n, to_n from endorsement where election = 2000 and turn = 2', params: [] })
  const roster = rosterOf(places, candidates, endorsements, spectrum, 2000)
  assert.deepEqual(roster.map((c) => [c.number, c.bloc, c.declared]), [['13', 'E', null], ['22', 'D', null], ['70', 'C', '22'], ['14', 'N', null]])
  const { units, groups } = unitsOf(places, roster, a, b, (p) => p.state)
  assert.deepEqual(groups.map((g) => g.id), ['a', 'b', 'c', 'c', 'rest', 'blank', 'abstention'])
  assert.equal(units.length, 3)
  assert.equal(transfersOf(places, roster, a, b, (p) => p.state), null, 'three places cannot tell seven groups apart')
})

test('the estimate gives every first-round group a distribution and compares the declared support with what followed', () => {
  const roster = [{ number: '3', name: 'C', party: 'P', declared: '2', votes: 600 }, { number: '4', name: 'D', party: 'Q', declared: '1', votes: 300 }]
  const places = []
  for (let k = 0; k < 120; k++) {
    const [a1, b1, c, d] = [200 + ((k * 37) % 150), 150 + ((k * 53) % 200), 20 + ((k * 11) % 60), 10 + ((k * 7) % 30)]
    const [bl1, ab1] = [15 + (k % 9), 100 + ((k * 13) % 80)]
    const nom = a1 + b1 + c + d
    const [a2, b2] = [Math.round(a1 + 0.3 * c + 0.4 * d), Math.round(b1 + 0.6 * c + 0.2 * d)]
    places.push({ state: 's', city: String(k % 7), zone: String(k), cast: { 3: c, 4: d },
      1: { a: a1, b: b1, nom, bl: bl1, nu: 0, ap: nom + bl1 + ab1, co: nom + bl1 }, 2: { a: a2, b: b2, nom: a2 + b2, bl: bl1, nu: 0, ap: nom + bl1 + ab1, co: a2 + b2 + bl1 } })
  }
  const r = transfersOf(places, roster, '1', '2', (p) => p.city)
  assert.deepEqual(r.rows.map((g) => g.id), ['a', 'b', 'c', 'c', 'rest', 'blank', 'abstention'])
  for (const g of r.rows) assert.ok(Math.abs(g.share.reduce((n, v) => n + v, 0) - 1) < 1e-6)
  const c = r.rows[2]
  assert.ok(c.share[1] > c.share[0], 'candidate C went mostly to the second finalist')
  const [forA, forB] = r.declared
  assert.equal(forB.declared, c.votes)
  assert.ok(forB.followed > 0 && forB.followed < forB.declared)
  assert.equal(forA.declared, r.rows[3].votes)
})

test('the governor winner of a municipality takes the bloc of his party and links to the finalist on his side', () => {
  const votes = [{ state: 'aa', city: '001', number: '45', votes: 10 }, { state: 'aa', city: '001', number: '13', votes: 4 }, { state: 'aa', city: '002', number: '13', votes: 9 }]
  const candidates = [{ state: 'aa', number: '45', name: 'DORIA', party: 'PSDB' }, { state: 'aa', number: '13', name: 'FULANO', party: 'PT' }]
  const spectrum = [{ party: 'PT', from_year: 1994, to_year: 2026, bloc: 'E' }, { party: 'PSDB', from_year: 1994, to_year: 2026, bloc: 'CD' }]
  const governors = governorsOf(votes, candidates, spectrum, 2000)
  assert.deepEqual([governors.get('aa|001').bloc, governors.get('aa|002').bloc], ['CD', 'E'])
  const [a, b] = [{ bloc: 'E' }, { bloc: 'D' }]
  assert.deepEqual([linkedTo('CE', a, b), linkedTo('CD', a, b), linkedTo('C', a, b), linkedTo('N', a, b)], ['a', 'b', null, null])
})

test('every runoff of president, governor or mayor pairs with a first round and the finest common grain is chosen', () => {
  assert.equal(firstRoundOf('2022-2', 'president'), '2022')
  assert.equal(firstRoundOf('2022', 'president'), null)
  assert.deepEqual(shiftOffices('2014-2'), ['president', 'governor'])
  assert.deepEqual(shiftOffices('2016-2'), ['mayor'])
  assert.deepEqual(shiftOffices('1989-2'), ['president'])
  assert.equal(firstRoundOf('e-2020-427-2-2020-11-29', 'mayor'), 'e-2020-426-1-2020-11-15')
  assert.equal(supportsView('2022', 'shift'), true)
  assert.equal(supportsView('1994-2', 'shift'), true)
  const rs = (key) => ({ first: firstRoundOf(key, 'president'), second: key })
  assert.equal(grainOf(rs('2014-2'), 'president'), 'zone')
  assert.equal(grainOf({ first: '1994', second: '1994-2' }, 'governor'), 'municipality')
  assert.equal(grainOf(rs('1989-2'), 'president'), 'state')
  assert.ok(ELECTIONS['2014-2'])
})

test('the 2026 runoff, without canonical votes, reads the collector tables at the municipality grain', async () => {
  const native = roundsOf('2026-2', 'president')
  assert.equal(grainOf(native, 'president'), 'native')
  const db = new PGlite()
  for (const t of ['res', 'tot', 'sgz', 'cands', 'residual']) await db.exec(manifest.tables[t].ddl)
  await db.exec(`create view resx as select election, turn, state, city, office, cand, votes from res; create view totx as select election, turn, state, city, office, sections, nominal, blank, nul from tot`)
  await insert(db, 'res', [[1, '13', 600], [1, '22', 300], [2, '13', 650], [2, '22', 330]].map(([turn, cand, votes]) => ({ election: 2026, turn, state: 'aa', city: 'Alfa', office: 1, cand, votes })))
  await insert(db, 'tot', [[1, 20, 30, 950], [2, 10, 10, 980]].map(([turn, blank, nul, nominal]) => ({ election: 2026, turn, state: 'aa', city: 'Alfa', office: 1, sections: 3, nominal, blank, nul })))
  await insert(db, 'sgz', [1, 2].map((turn) => ({ election: 2026, turn, state: 'aa', city: 'Alfa', zone: '1', aptos: 1200, comp: 1000 })))
  await insert(db, 'cands', [['13', 'LULA', 'PT'], ['22', 'JAIR', 'PL']].map(([n, name, party]) => ({ election: 2026, turn: 1, uf: 'br', office: 1, n, name, short_name: name, party })))
  const units = await load(db, unitsSql(native, 'president', 'native'))
  assert.deepEqual(units.map((u) => [u.turn, +u.eligible, +u.present, +u.nominal]).sort(), [[1, 1200, 1000, 950], [2, 1200, 1000, 980]])
  assert.equal((await load(db, votesSql(native, 'president', 'native'))).length, 4)
  assert.deepEqual((await load(db, candidatesSql(native, 'president', null, 'native'))).map((c) => [c.state, c.number, c.name]), [[null, '13', 'LULA'], [null, '22', 'JAIR']])
})
