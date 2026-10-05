// Builds the Benford data parts (tables benford_hist, benford_base, benford_stat) from the read-only election databases (via psql
// and a scratch database), for the elections configured in src/elections.js: a new election or turn is a config entry there plus,
// for a new source kind, an adapter in scripts/benford/sources.mjs.
//   nice -n 10 node scripts/build-benford.mjs [--election=2022,2026] [--offices=1,3] [--skip-extract] [--reps=200]
// Steps per election turn and office: copy the section facts to the scratch database (one snapshot) -> plan the series -> observed
// digit histograms in SQL -> check them against a JS recomputation -> binomial baseline in Node (fixed seed, reproducible) -> parts
// data/<table>/<election key>-<part>.csv.gz, registered in data/manifest.json like every other table of the shared schema.
import { readFileSync, writeFileSync } from 'node:fs'
import { ELECTIONS, ELECTION_LIST } from '../src/elections.js'
import { baseline, scopeKey } from './benford/baseline.mjs'
import { check } from './benford/check.mjs'
import { observed, storeSeries } from './benford/hist.mjs'
import { loadFacts, loadOffice } from './benford/load.mjs'
import { PARAMS, plan } from './benford/plan.mjs'
import { baseRows, histRows, register, statRows, writeParts } from './benford/parts.mjs'
import { extract, SCRATCH } from './benford/scratch.mjs'
import { rows } from './benford/psql.mjs'

const opt = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')))
const list = (k, all) => (opt[k] ? opt[k].split(',') : all)
const keys = list('election', ELECTION_LIST.map((e) => e.key))
if (opt.reps) PARAMS.reps = +opt.reps
const ROOT = 'data'
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

const totalsOf = async ({ year, turn }, office) => (await rows(SCRATCH, `select s.uf, f.cand, sum(f.votes) from fact f join sec s on s.election = f.election and s.turn = f.turn and s.office = f.office and s.id = f.id
  where f.election = ${year} and f.turn = ${turn} and f.office = ${office} group by 1, 2`)).map(([uf, cand, votes]) => ({ uf, cand, votes: +votes }))

async function buildOffice(el, office) {
  const tag = `${el.key}/${office}`
  const totals = await totalsOf(el, office)
  if (!totals.length) { log(`${tag}: no sections in the source, skipped`); return { obs: [], base: [] } } // e.g. a runoff has no deputy offices
  const series = plan(office, totals)
  await storeSeries(el, office, series)
  log(`${tag}: ${series.length} series places planned`)
  const obs = await observed(el, office)
  log(`${tag}: ${obs.length} observed scopes from SQL`)
  const data = await loadOffice(el, office)
  const facts = await loadFacts(el, office, new Set(series.map((s) => s.cand)))
  log(`${tag}: JS recomputation agrees on ${check(data, facts, obs)} scopes`)
  const base = await baseline(el, office, data, facts, series, obs, log)
  return { obs: obs.map((s) => ({ ...s, office })), base: base.map((s) => ({ ...s, office })) }
}

const built = { keys, parts: { benford_hist: {}, benford_base: {}, benford_stat: {} } }
const manifestFile = `${ROOT}/manifest.json`
const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'))

for (const key of keys) {
  const el = ELECTIONS[key]
  if (!('skip-extract' in opt)) await extract(el, log)
  const [obs, base] = [[], []]
  for (const office of (opt.offices ? list('offices').map(Number) : el.offices)) {
    const r = await buildOffice(el, office)
    obs.push(...r.obs)
    base.push(...r.base)
  }
  for (const scopes of [obs, base]) scopes.sort((a, b) => (scopeKey(a) < scopeKey(b) ? -1 : 1)) // SQL gives no order: sorted rows make the parts reproducible
  Object.assign(built.parts.benford_hist, writeParts(ROOT, el, 'benford_hist', histRows(el, obs)))
  Object.assign(built.parts.benford_base, writeParts(ROOT, el, 'benford_base', baseRows(el, base, PARAMS.reps)))
  Object.assign(built.parts.benford_stat, writeParts(ROOT, el, 'benford_stat', statRows(el, base, PARAMS.reps)))
  log(`${key}: ${obs.length} observed scopes, ${base.length} baseline scopes written`)
}

register(manifest, built, PARAMS)
manifest.version = new Date().toISOString()
writeFileSync(manifestFile, JSON.stringify(manifest, null, 1) + '\n')
const bytes = Object.values(built.parts).flatMap((p) => Object.values(p)).reduce((t, p) => t + p.bytes, 0)
log(`manifest written; benford parts: ${(bytes / 1e6).toFixed(2)} MB gzip`)
