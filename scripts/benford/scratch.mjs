// The scratch database (bf_*): the section facts of every election/office copied once from the read-only sources, so the
// histograms are plain SQL on a compact table and the simulation reads the same snapshot.
import { mkdirSync } from 'node:fs'
import { psql, snapshotDump } from './psql.mjs'
import { ADAPTERS } from './sources.mjs'

export const SCRATCH = 'bf_benford'
const TMP = '/tmp/bf-benford'

const DDL = `create table if not exists sec (election int, turn int, office int, id int, uf text, city text, size int);
  create table if not exists fact (election int, turn int, office int, id int, cand text, votes int);`

/** Copies one election turn (an entry of src/elections.js) into the scratch database, replacing what it had for its offices. */
export async function extract(el, log) {
  mkdirSync(TMP, { recursive: true })
  await psql(SCRATCH, DDL)
  const adapter = ADAPTERS[el.source.kind]
  if (!adapter) throw new Error(`no source adapter for kind '${el.source.kind}' (election ${el.key}) in scripts/benford/sources.mjs`)
  for (const office of el.offices) {
    const [sec, fact] = [`${TMP}/sec-${el.key}-${office}.csv`, `${TMP}/fact-${el.key}-${office}.csv`]
    const sql = adapter(el)(office)
    await snapshotDump(el.source.db, [[sql.sec, sec], [sql.fact, fact]])
    const where = `election = ${el.year} and turn = ${el.turn} and office = ${office}`
    await psql(SCRATCH, `delete from sec where ${where}; delete from fact where ${where};
      \\copy sec from '${sec}' csv
      \\copy fact from '${fact}' csv\n`)
    log(`extracted ${el.key}/${office}`)
  }
  await psql(SCRATCH, `drop index if exists sec_ix; drop index if exists fact_ix; create index sec_ix on sec (election, turn, office, id); create index fact_ix on fact (election, turn, office, cand); analyze sec; analyze fact;`)
}
