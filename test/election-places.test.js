import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { PGlite } from '@electric-sql/pglite'

const manifest = JSON.parse(readFileSync(new URL('../data/manifest.json',import.meta.url)))
const table = manifest.tables.election_places

test('source municipality names join electoral counts once and keep the runoff source distinct', async () => {
  const db = await PGlite.create()
  try {
    await db.exec(table.ddl)
    for (const id of ['1998/ac','2026-2/ac']) {
      const part = table.parts[id]
      const bytes = gunzipSync(readFileSync(new URL(`../data/${part.url}`,import.meta.url)))
      await db.query(`copy election_places (${table.columns}) from '/dev/blob' csv`,[],{blob:new Blob([bytes])})
      const actual = await db.query('select count(*)::int n from election_places where session_key=$1',[id.split('/')[0]])
      assert.equal(actual.rows[0].n,part.rows)
    }
    await db.exec("create table observed_votes(session_key text,state text,city_code text,votes int); insert into observed_votes values ('1998','ac','01392',7),('1998','ac','01392',11)")
    const joined = await db.query('select sum(votes)::int votes,max(city_name) city from observed_votes left join election_places using(session_key,state,city_code)')
    assert.equal(joined.rows[0].votes,18)
    assert.match(joined.rows[0].city,/RIO BRANCO/i)
    const runoff = await db.query("select city_name,provenance from election_places where session_key='2026-2' and city_code='01120'")
    assert.match(runoff.rows[0].city_name,/ACRELÂNDIA/)
    assert.match(JSON.stringify(runoff.rows[0].provenance),/6258\/config\/mun-e006258/)
  } finally { await db.close() }
})
