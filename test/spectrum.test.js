import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { VIEWS } from '../src/model.js'
import { blocOfScore, blocsSql, coalitionsSql, crossTab, paradoxOf, paradoxes, topSql, winnersOf } from '../src/spectrum.js'

const manifest = JSON.parse(readFileSync('data/manifest.json', 'utf8'))
const insert = (db, table, rows) => Promise.all(rows.map((r) => db.query(`insert into ${table} (${Object.keys(r).join(',')}) values (${Object.keys(r).map((_, i) => `$${i + 1}`).join(',')})`, Object.values(r))))

async function fixture() {
  const db = new PGlite()
  for (const t of ['rdv', 'res', 'tot', 'residual', 'cands', 'spectrum', 'coalition']) await db.exec(manifest.tables[t].ddl)
  for (const v of VIEWS) await db.exec(v)
  await insert(db, 'spectrum', [['PT', 1994, 2026, 'E'], ['PSDB', 1994, 2026, 'C'], ['PL', 1994, 2018, 'CD'], ['PL', 2019, 2026, 'D']].map(([party, from_year, to_year, bloc]) => ({ party, from_year, to_year, bloc })))
  const cand = (uf, office, n, party, name) => ({ election: 2022, turn: 1, uf, office, n, party, name, short_name: name, official_votes: 0 })
  await insert(db, 'cands', [cand('br', 1, '13', 'PT', 'LULA'), cand('br', 1, '22', 'PL', 'JAIR'), cand('aa', 3, '45', 'PSDB', 'DORIA'), cand('aa', 3, '22', 'PL', 'GOV'), cand('aa', 3, '13', 'PT', 'GOVPT')])
  const vote = (city, office, cand, votes) => ({ election: 2022, turn: 1, state: 'aa', city, office, cand, votes })
  await insert(db, 'res', [vote('X', 1, '13', 60), vote('X', 1, '22', 40), vote('X', 3, '22', 70), vote('X', 3, '45', 30), vote('Y', 1, '13', 80), vote('Y', 1, '22', 20), vote('Y', 3, '13', 55), vote('Y', 3, '45', 45)])
  const member = (seq, name, kind, party) => ({ election: 2022, turn: 1, uf: 'br', office: 1, seq, kind, name, party, federation: '', status: null })
  await insert(db, 'coalition', [member('1', 'Juntos', 'coalition', 'PT'), member('1', 'Juntos', 'coalition', 'PSDB'), member('2', 'Sozinho', 'party', 'PL'), { ...member('3', 'Barrada', 'party', 'PT'), status: 'indeferido' }, { ...member('4', 'Aceita', 'party', 'PSDB'), status: 'deferido' }])
  return db
}

const roster = { sql: `select * from (values ('13', '13', 'LULA', null, 'PT', 60), ('22', '22', 'JAIR', null, 'PL', 40), ('99', '99', 'NOVO', null, 'XYZ', 5)) c(cand, number, name, short_name, party_label, votes)`, params: [] }

test('votes are summed by the bloc of the party in the year of the election', async () => {
  const db = await fixture()
  const { rows } = await db.query(...Object.values(blocsSql(roster, 2022)))
  assert.deepEqual(rows.map((r) => [r.bloc, Number(r.votes), r.candidates]).sort(), [['D', 40, 1], ['E', 60, 1], ['N', 5, 1]])
  assert.equal((await db.query(...Object.values(blocsSql(roster, 2014)))).rows.find((r) => r.votes == 40).bloc, 'CD')
  const [first] = (await db.query(...Object.values(topSql(roster, 2022, 1)))).rows
  assert.deepEqual([first.name, first.bloc], ['LULA', 'E'])
})

test('a coalition stands at the average of its classified parties and refused registrations are left out', async () => {
  const db = await fixture()
  const { rows } = await db.query(...Object.values(coalitionsSql(2022, 1, 1, 'br')))
  assert.deepEqual(rows.map((r) => [r.name, r.parties, r.known, r.score]), [['Juntos', 2, 2, -1], ['Sozinho', 1, 1, 2], ['Aceita', 1, 1, 0]])
  assert.equal(rows[0].members, 'PSDB (C), PT (E)')
  assert.deepEqual([-2, -1.4, 0, 0.6, 2, null].map(blocOfScore), ['E', 'CE', 'C', 'CD', 'D', 'N'])
})

test('the municipalities where president and governor stand on opposite sides', async () => {
  const db = await fixture()
  const spectrum = (await db.query('select * from spectrum')).rows
  const president = winnersOf([{ state: 'aa', city: 'X', number: '13', votes: 60 }, { state: 'aa', city: 'X', number: '22', votes: 40 }, { state: 'aa', city: 'Y', number: '13', votes: 80 }, { state: 'aa', city: 'Y', number: '22', votes: 20 }],
    [{ state: null, number: '13', name: 'LULA', party: 'PT' }, { state: null, number: '22', name: 'JAIR', party: 'PL' }], spectrum, 2022)
  const governor = winnersOf([{ state: 'aa', city: 'X', number: '22', votes: 70 }, { state: 'aa', city: 'X', number: '45', votes: 30 }, { state: 'aa', city: 'Y', number: '13', votes: 55 }, { state: 'aa', city: 'Y', number: '45', votes: 45 }],
    [{ state: 'aa', number: '22', name: 'GOV', party: 'PL' }, { state: 'aa', number: '45', name: 'DORIA', party: 'PSDB' }, { state: 'aa', number: '13', name: 'GOVPT', party: 'PT' }], spectrum, 2022)
  const found = paradoxOf(president, governor)
  assert.deepEqual(paradoxes(found).map((r) => [r.city, r.pbloc, r.gbloc]), [['X', 'E', 'D']])
  const cross = crossTab(found)
  assert.equal(cross.flatMap((r) => r.cells).reduce((n, c) => n + c.n, 0), 2)
  assert.equal(cross.find((r) => r.side === 'left').cells.find((c) => c.side === 'right').n, 1)
})
