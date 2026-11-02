import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { VIEWS } from '../src/model.js'
import { childrenSql, citiesSql, estimateUnitsSql, finalistsSql, rosterSql, unitsOf, shiftOf, totalOf, pools, firstRoundOf, hasShift, transfersOf } from '../src/shift.js'

const manifest = JSON.parse(readFileSync('data/manifest.json', 'utf8'))
const insert = (db, table, rows) => Promise.all(rows.map((r) => db.query(`insert into ${table} (${Object.keys(r).join(',')}) values (${Object.keys(r).map((_, i) => `$${i + 1}`).join(',')})`, Object.values(r))))

// Two municipalities of one state, two rounds: the identity of the shift must hold at every level, from the sections up to the country.
async function fixture() {
  const db = new PGlite()
  for (const t of ['rdv', 'res', 'tot', 'residual', 'sg', 'sgz', 'cands', 'endorsement', 'spectrum']) await db.exec(manifest.tables[t].ddl)
  for (const v of VIEWS) await db.exec(v)
  const sec = (turn, zone, section, votes, blank, nul, aptos, comp) => ({ election: 2026, turn, state: 'aa', city: 'X', zone, section, model: 'UE', office: 1, nominal: Object.values(votes).reduce((a, b) => a + b, 0), blank, nul, votes: JSON.stringify(votes), aptos, comp })
  const sections = [
    sec(1, '0001', '0001', { 13: 40, 22: 30, 70: 10, 14: 5 }, 3, 2, 120, 90), sec(1, '0001', '0002', { 13: 20, 22: 50, 70: 5 }, 2, 3, 100, 80), sec(1, '0002', '0001', { 13: 30, 22: 30, 14: 10 }, 5, 5, 100, 80),
    sec(2, '0001', '0001', { 13: 70, 22: 40 }, 5, 3, 121, 118), sec(2, '0001', '0002', { 13: 30, 22: 60 }, 1, 2, 100, 93), sec(2, '0002', '0001', { 13: 55, 22: 35 }, 4, 2, 101, 96),
  ]
  await insert(db, 'rdv', sections.map(({ aptos, comp, ...r }) => r))
  await insert(db, 'sg', sections.map((s) => ({ election: s.election, turn: s.turn, state: s.state, city: s.city, zone: s.zone, section: s.section, aptos: s.aptos, comp: s.comp })))
  const res = (turn, city, votes) => Object.entries(votes).map(([cand, v]) => ({ election: 2026, turn, state: 'aa', city, office: 1, cand, votes: v }))
  await insert(db, 'res', [...res(1, 'X', { 13: 90, 22: 110, 70: 15, 14: 15 }), ...res(2, 'X', { 13: 155, 22: 135 }), ...res(1, 'Y', { 13: 10, 22: 20 }), ...res(2, 'Y', { 13: 15, 22: 25 })])
  await insert(db, 'tot', [[1, 'X', 230, 10, 10], [2, 'X', 290, 10, 7], [1, 'Y', 30, 0, 0], [2, 'Y', 40, 0, 0]].map(([turn, city, nominal, blank, nul]) => ({ election: 2026, turn, state: 'aa', city, office: 1, sections: 3, nominal, blank, nul })))
  await insert(db, 'sgz', [[1, 'X', '0001', 220, 170], [1, 'X', '0002', 100, 80], [2, 'X', '0001', 221, 211], [2, 'X', '0002', 101, 96], [1, 'Y', '0001', 40, 30], [2, 'Y', '0001', 45, 40]]
    .map(([turn, city, zone, aptos, comp]) => ({ election: 2026, turn, state: 'aa', city, zone, sections: 1, aptos, comp })))
  await insert(db, 'cands', [[2, '13', 'LULA', 'PT', 155], [2, '22', 'FLAVIO', 'PL', 135], [1, '70', 'CURY', 'AVANTE', 15], [1, '14', 'RENAN', 'MISSAO', 15]]
    .map(([turn, n, name, party, official_votes]) => ({ election: 2026, turn, uf: 'br', office: 1, n, name, short_name: name, party, official_votes })))
  await insert(db, 'endorsement', [{ election: 2026, turn: 2, n: '70', to_n: '22', source: 'test' }])
  return db
}

const rows = async (db, { sql, params }) => (await db.query(sql, params)).rows.map((r) => shiftOf(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'string' && /^\d+$/.test(v) && k !== 'k' ? Number(v) : v]))))

test('the finalists are the two runoff candidates, the winner first', async () => {
  const db = await fixture()
  const { rows: f } = await db.query(...Object.values(finalistsSql(2026)))
  assert.deepEqual(f.map((r) => r.n), ['13', '22'])
})

test('the identity holds for the sections of a zone, the zones of a city, the cities of a state and the country', async () => {
  const db = await fixture()
  for (const args of [[], ['aa'], ['aa', 'X'], ['aa', 'X', '0001']]) {
    const found = await rows(db, childrenSql(args, 2026, '13', '22'))
    assert.ok(found.length > 0, `children of ${args.join('/') || 'Brazil'}`)
    for (const r of found) assert.equal(r.gap, 0, `${args.join('/')} ${r.k}`)
  }
  const [section] = (await rows(db, childrenSql(['aa', 'X', '0001'], 2026, '13', '22'))).filter((r) => r.k === '0001')
  assert.deepEqual([section.d.a, section.d.b, section.others1, section.d.nu, section.d.bl, section.d.abs, section.d.ap, section.result], [30, 10, 15, 1, 2, -27, 1, 40])
})

test('the total of the municipalities is the total of the country and a place turns when the finalists swap', async () => {
  const db = await fixture()
  const cities = await rows(db, citiesSql(2026, '13', '22'))
  const total = totalOf(cities)
  assert.equal(total.gap, 0)
  assert.equal(total.d.a + total.d.b, 100)
  assert.deepEqual(cities.map((r) => [r.city, r.turned]).sort(), [['X', true], ['Y', false]])
  assert.deepEqual(pools(total).map((p) => p.id), ['others', 'nu', 'bl', 'abs', 'ap'])
})

test('the places to estimate from come from the rollups and from the sections, with the declared support in the roster', async () => {
  const db = await fixture()
  const roster = (await db.query(...Object.values(rosterSql(2026)))).rows
  assert.deepEqual(roster.map((r) => [r.n, r.declared]).sort(), [['14', null], ['70', '22']])
  const load = async ({ places, votes }) => ({ places: (await db.query(places.sql, places.params)).rows, votes: (await db.query(votes.sql, votes.params)).rows })
  const country = unitsOf(await load(estimateUnitsSql([], 2026, '13', '22')), roster, '13', '22')
  assert.deepEqual(country.units.map((u) => u.k).sort(), ['aa/X', 'aa/Y'])
  assert.equal(country.units.find((u) => u.k === 'aa/X').y[0], 155)
  const zone = unitsOf(await load(estimateUnitsSql(['aa', 'X', '0001'], 2026, '13', '22')), roster, '13', '22')
  assert.deepEqual(zone.units.map((u) => u.k).sort(), ['0001/0001', '0001/0002'])
  assert.deepEqual(country.groups.map((g) => g.id), ['a', 'b', 'c', 'c', 'rest', 'blank', 'abstention'])
})

test('only the runoffs with the first round of the same year offer the shift', () => {
  assert.equal(firstRoundOf('2022-2'), '2022')
  assert.equal(firstRoundOf('2022'), '2022')
  assert.equal(hasShift('2022'), false)
  assert.equal(hasShift('2022-2'), true)
})

test('the estimate gives every first-round group a distribution and compares the declared support with what followed', () => {
  const roster = [{ n: '3', name: 'C', party: 'P', declared: '2', votes: 600 }, { n: '4', name: 'D', party: 'Q', declared: '1', votes: 300 }]
  const places = [], votes = []
  for (let k = 0; k < 120; k++) {
    const [a1, b1, c, d] = [200 + ((k * 37) % 150), 150 + ((k * 53) % 200), 20 + ((k * 11) % 60), 10 + ((k * 7) % 30)]
    const [bl1, ab1] = [15 + (k % 9), 100 + ((k * 13) % 80)]
    const nom = a1 + b1 + c + d
    const [a2, b2] = [Math.round(a1 + 0.3 * c + 0.4 * d), Math.round(b1 + 0.6 * c + 0.2 * d)]
    places.push({ k: `p${k}`, turn: 1, a: a1, b: b1, nom, bl: bl1, nu: 0, ap: nom + bl1 + ab1, co: nom + bl1 })
    places.push({ k: `p${k}`, turn: 2, a: a2, b: b2, nom: a2 + b2, bl: bl1, nu: 0, ap: nom + bl1 + ab1, co: a2 + b2 + bl1 })
    votes.push({ k: `p${k}`, cand: '3', votes: c }, { k: `p${k}`, cand: '4', votes: d })
  }
  const r = transfersOf({ places, votes }, roster, '1', '2')
  assert.deepEqual(r.rows.map((g) => g.id), ['a', 'b', 'c', 'c', 'rest', 'blank', 'abstention'])
  for (const g of r.rows) assert.ok(Math.abs(g.share.reduce((n, v) => n + v, 0) - 1) < 1e-6)
  const [c, d] = [r.rows[2], r.rows[3]]
  assert.ok(c.share[1] > c.share[0], 'candidate C went mostly to the second finalist')
  const [forA, forB] = r.declared
  assert.equal(forB.declared, c.votes)
  assert.ok(forB.followed > 0 && forB.followed < forB.declared)
  assert.equal(forA.declared, d.votes)
})
