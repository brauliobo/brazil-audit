import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { childrenSql, lowestSql, sharesOf, totalOf } from '../src/biometrics.js'

const manifest = JSON.parse(readFileSync('data/manifest.json', 'utf8'))
const insert = (db, table, rows) => Promise.all(rows.map((r) => db.query(`insert into ${table} (${Object.keys(r).join(',')}) values (${Object.keys(r).map((_, i) => `$${i + 1}`).join(',')})`, Object.values(r))))

async function fixture() {
  const db = new PGlite()
  for (const t of ['sg', 'sgz']) await db.exec(manifest.tables[t].ddl)
  const sec = (city, zone, section, bio, man, nor) => ({ election: 2022, turn: 1, state: 'aa', city, zone, section, bio, man, nor })
  const sections = [sec('X', '0001', '0001', 80, 10, 10), sec('X', '0001', '0002', 30, 40, 30), sec('X', '0002', '0001', 50, 25, 25), sec('Y', '0001', '0001', 90, 5, 5)]
  await insert(db, 'sg', sections)
  const zones = new Map()
  for (const s of sections) { const z = zones.get(`${s.city}${s.zone}`) ?? { ...s, section: undefined, bio: 0, man: 0, nor: 0 }; z.bio += s.bio; z.man += s.man; z.nor += s.nor; zones.set(`${s.city}${s.zone}`, z) }
  await insert(db, 'sgz', [...zones.values()].map(({ section, ...z }) => z))
  return db
}

test('each level answers from the rollups and the sections below the zone add up to the same totals', async () => {
  const db = await fixture()
  const rows = async (args) => (await db.query(...Object.values(childrenSql(args, 2022, 1)))).rows
  assert.deepEqual((await rows([])).map((r) => r.k), ['aa'])
  assert.deepEqual((await rows(['aa'])).map((r) => r.k).sort(), ['X', 'Y'])
  assert.deepEqual((await rows(['aa', 'X'])).map((r) => r.k).sort(), ['0001', '0002'])
  const sections = await rows(['aa', 'X', '0001'])
  assert.deepEqual(sections.map((r) => r.k).sort(), ['0001', '0002'])
  const [zone] = (await rows(['aa', 'X'])).filter((r) => r.k === '0001')
  assert.equal(totalOf(sections).total, Number(zone.bio) + Number(zone.man) + Number(zone.nor))
})

test('the sections without the fingerprint come first and shares need identifications', async () => {
  const db = await fixture()
  const { rows } = await db.query(...Object.values(lowestSql(2022, 1, 'aa', 50)))
  assert.deepEqual(rows.map((r) => `${r.city}${r.zone}${r.section}`), ['X00010002', 'X00020001', 'X00010001', 'Y00010001'])
  assert.equal(sharesOf({ bio: 0, man: 0, nor: 0 }).noFpShare, null)
  assert.equal(sharesOf(rows[0]).noFpShare, 0.7)
})
