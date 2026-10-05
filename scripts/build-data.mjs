// Builds the shippable dump in data/ from the local read-only Postgres databases (via psql) and the TSE/IBGE downloads.
//   nice -n 10 node scripts/build-data.mjs [--election=2022,2026] [--states=ac,ro] [--only=rdv,vt,results,cands,geo,elected,residual]
// ONE schema for every election (tables with `election` and `turn` columns, see SCHEMA); the elections are configured in
// src/elections.js. Output: data/manifest.json + gzip CSV parts per table, election and UF (loaded into PGlite with
// COPY ... FROM '/dev/blob'): data/<table>/<year>[-<uf>].csv.gz. Parts of unselected elections/UFs are kept.
import { spawn } from 'node:child_process'
import { createGzip, gunzipSync, gzipSync } from 'node:zlib'
import { createWriteStream, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import { ELECTIONS } from '../src/elections.js'
import { parseCsvLine } from './csv.mjs'
import { EMPTY, RDV, dumpOf, officesOf, officialFile, residualOf } from './official.mjs'
import { buildGeometry, cached, tseMunicipalities } from './geo.mjs'

const opt = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')))
const list = (k, all) => (opt[k] ? opt[k].split(',') : all)
const SELECTED = list('election', Object.keys(ELECTIONS)).map((k) => ELECTIONS[k])
const ONLY = list('only', ['rdv', 'vt', 'results', 'cands', 'geo', 'elected', 'residual'])
const OUT = 'data'
const T0 = 18000 // time-of-day buckets: 05:00 local clock, 10 minutes each, 90 buckets (05:00-20:00), edges clamped
const STEP = 600
const NB = 90

// Fernando de Noronha runs on UTC-2 but its polls still open at 08:00 BRT (09:00 on its clock): the estimate below would be capped to 0
const FIXED_TZ = { 'pe/FERNANDO DE NORONHA': 1 }

// The shared schema. Every table starts with `election int, turn int` (cands has its own election column, mun_map has none).
const SCHEMA = {
  rdv: 'state text, city text, zone text, section text, model text, office int, nominal int, blank int, nul int, votes jsonb',
  vt: 'state text, city text, zone text, section text, model text, n int, first int, last int, med int, p10 int, p90 int, maxgap int, b smallint[]',
  vtc: 'state text, city text, sections int, n int, tz int, b int[]',
  tot: 'state text, city text, office int, sections int, nominal bigint, blank bigint, nul bigint',
  res: 'state text, city text, office int, cand text, votes bigint',
  cov: 'state text, own int, stored int, aggregated int, missing int',
  miss: 'state text, city text, zone text, section text',
  residual: 'uf text, city text, city_code text, zone text, office int, number text, votes bigint, sections_missing int',
  residual_skipped: 'uf text, city text, zone text, office int, reason text, detail text',
  elected: 'uf text, office int, n text, name text, party text, status text, votes bigint',
  seats: 'uf text, office int, bloc text, seats int',
}

const q = (s) => `'${s.replaceAll("'", "''")}'`
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const loaded = existsSync(`${OUT}/manifest.json`) ? JSON.parse(readFileSync(`${OUT}/manifest.json`, 'utf8')) : {}
const manifest = loaded.tables ? loaded : { tables: {} }

function psql(db, script) {
  const env = { ...process.env, PGOPTIONS: '-c statement_timeout=900000 -c client_min_messages=error' }
  const p = spawn('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', db], { env })
  // the 2022 database warns about a harmless collation version mismatch on every connection
  p.stderr.on('data', (d) => process.stderr.write(d.toString().split('\n').filter((l) => l && !/collation/.test(l)).join('\n')))
  const done = new Promise((res, rej) => p.on('close', (c) => (c ? rej(new Error(`psql exited ${c}`)) : res())))
  p.stdin.end(script)
  return { out: p.stdout, done }
}

const copy = (queries) => queries.map((x) => `\\copy (${x.replace(/\s+/g, ' ')}) to stdout csv\n`).join('')

async function text(db, queries) {
  const { out, done } = psql(db, copy(queries))
  const chunks = []
  for await (const c of out) chunks.push(c)
  await done
  return Buffer.concat(chunks).toString()
}

const scalar = async (db, sql) => (await text(db, [sql])).trim().split('\n').filter(Boolean).map((l) => l.replace(/^"|"$/g, ''))

// streams the queries' CSV through gzip into `file` (never held in memory, SP deputies are ~0.5 GB raw)
async function dump(db, queries, file) {
  mkdirSync(file.slice(0, file.lastIndexOf('/')), { recursive: true })
  const stats = { rows: 0, rawBytes: 0 }
  const count = new Transform({
    transform(c, _, cb) {
      stats.rawBytes += c.length
      for (let i = c.indexOf(10); i >= 0; i = c.indexOf(10, i + 1)) stats.rows++
      cb(null, c)
    },
  })
  const { out, done } = psql(db, copy(queries))
  await Promise.all([pipeline(out, count, createGzip({ level: 9 }), createWriteStream(file)), done])
  return stats
}

/** The manifest entry of a shared table (columns and DDL come from SCHEMA). */
function table(name) {
  const cols = SCHEMA[name].split(',').map((c) => c.trim().split(' ')[0]).join(',')
  return (manifest.tables[name] ??= { name, columns: `election,turn,${cols}`, ddl: `create table ${name} (election int, turn int, ${SCHEMA[name]})`, parts: {} })
}

/** Registers a part file: key `<year>/<part>`, `where` = the rows the part owns (the loader deletes them before a re-import). */
function part(tableDef, el, key, file, stats, where, extra = {}) {
  const id = `${el.key}/${key}`
  if (!stats.rows) { unlinkSync(file); delete tableDef.parts[id]; return }
  const bytes = readFileSync(file).length
  if (bytes > 50e6) console.warn(`WARNING ${file} is ${bytes} bytes, above the 50 MB part target`)
  tableDef.parts[id] = { url: file.replace(`${OUT}/`, ''), bytes, ...stats, where: `election = ${el.year} and turn = ${el.turn}${where ? ` and ${where}` : ''}`, ...extra }
  log(`${tableDef.name}/${id}: ${stats.rows} rows, raw ${stats.rawBytes}, gz ${bytes}`)
}

const csvOf = (rows) => (rows.length ? rows.map((r) => r.map((v) => (v == null ? '' : /[,"\n]/.test(v) ? `"${String(v).replaceAll('"', '""')}"` : v)).join(',')).join('\n') + '\n' : '')

/** A small table of one election in a single part (rows without the election/turn columns). */
function smallTable(name, el, rows) {
  const body = csvOf(rows.map((r) => [el.year, el.turn, ...r]))
  const file = `${OUT}/${name}/${el.key}.csv.gz`
  mkdirSync(`${OUT}/${name}`, { recursive: true })
  writeFileSync(file, gzipSync(body, { level: 9 }))
  const t = table(name)
  t.parts[`${el.key}/all`] = { url: `${name}/${el.key}.csv.gz`, bytes: readFileSync(file).length, rows: rows.length, rawBytes: body.length, where: `election = ${el.year} and turn = ${el.turn}` }
  log(`${name}/${el.key}: ${rows.length} rows, ${t.parts[`${el.key}/all`].bytes} bytes gz`)
}

// ---- rdv: section results per office, in the shape of the 2026 collector for every election ----------------------------------
// votes = {candidate number: votes} of RDV kind 2 only. null ballots = kinds 4 (invalid number) + 6 + 7 (second senate vote), as the
// official null total counts them. The open-data sources use the same kinds (3 blank, 4 null) for 2018 and 2022.
const sumOf = (...kinds) => kinds.map((k) => `(select coalesce(sum(value::int),0) from jsonb_each_text(votes->'${k}'))`).join('+')
// one lazy part per office group: president/governor/senator together, each deputy office on its own (the bulk of the bytes)
const OFFICE_PARTS = { main: [1, 3, 5], 6: [6], 7: [7], 8: [8] }

// the open-data databases hold both rounds in one rdv_votes (a `turn` column) and have no urn model
const isOpen = (el) => el.source.kind === 'open'
const onTurn = (el, prefix = 'and') => (isOpen(el) ? ` ${prefix} turn = ${el.turn}` : '')
const rdvSql = (el, s, offices) => `select ${el.year},${el.turn},state,city,zone,section,${isOpen(el) ? "''" : 'model'},office,${sumOf(2)},${sumOf(3)},${sumOf(4, 6, 7)},
  coalesce(votes->'2','{}'::jsonb) from rdv_votes where state=${q(s)} and office in (${offices})${onTurn(el)} order by city,zone,section${isOpen(el) ? '' : ',model'},office`

const statesOf = (el) => scalar(el.source.db, `select distinct state from rdv_votes${onTurn(el, 'where')} order by 1`)
const citiesSql = (el) => `select distinct state,city from rdv_votes where office=1${onTurn(el)}`

async function buildRdv(el) {
  const rdv = table('rdv')
  for (const s of list('states', await statesOf(el))) {
    for (const [group, wanted] of Object.entries(OFFICE_PARTS)) {
      const offices = wanted.filter((o) => el.offices.includes(o))
      if (!offices.length) continue
      const key = group === 'main' ? s : `${s}.${group}`
      const file = `${OUT}/rdv/${el.key}-${key}.csv.gz`
      part(rdv, el, key, file, await dump(el.source.db, [rdvSql(el, s, offices)], file), `state = ${q(s)} and office in (${offices})`, { offices })
    }
  }
}

// ---- vt: voting times (Presidente post only, one event per voter), computed in Postgres per state ---------------------------
const buckets = Array.from({ length: NB }, (_, i) => `count(*) filter (where bk=${i})`).join(',')
// One index probe per section (state,city,zone,section,model,post prefix): ~300x faster than scanning the city's range
// and filtering post, because the index puts post after model. Sections come from rdv_votes (the scraped results).
const vtSql = (el, s, city) => `with e as (select sec.zone,sec.section,sec.model,x.sc,x.sc-lag(x.sc) over (partition by sec.zone,sec.section,sec.model order by x.time) gap
  from (select zone,section,model from rdv_votes where state=${q(s)} and city=${q(city)} and office=1) sec
  cross join lateral (select time,(extract(epoch from time)::bigint % 86400)::int sc from voting_times v where v.state=${q(s)} and v.city=${q(city)}
    and v.zone=sec.zone and v.section=sec.section and v.model=sec.model and v.post='Presidente') x),
  b as (select *,least(greatest((sc-${T0})/${STEP},0),${NB - 1}) bk from e)
  select ${el.year},${el.turn},${q(s)},${q(city)},zone,section,model,count(*),min(sc),max(sc),round(percentile_cont(.5) within group (order by gap)),
  round(percentile_cont(.1) within group (order by gap)),round(percentile_cont(.9) within group (order by gap)),max(gap),
  '{'||concat_ws(',',${buckets})||'}' from b group by zone,section,model order by zone,section,model`

async function buildVt(el) {
  const vt = table('vt')
  const t0 = Date.now()
  for (const s of list('states', await statesOf(el))) {
    const cities = await scalar(el.source.db, `select distinct city from rdv_votes where state=${q(s)} and office=1 order by 1`)
    const file = `${OUT}/vt/${el.key}-${s}.csv.gz`
    part(vt, el, s, file, await dump(el.source.db, cities.map((c) => vtSql(el, s, c)), file), `state = ${q(s)}`)
    log(`${s} done, ${((Date.now() - t0) / 60000).toFixed(1)} min since start`)
  }
}

// City rollups of the section buckets (so state/country charts never scan the section table), always rebuilt from the vt parts on
// disk. `tz` = estimated hours of the recorded local clock vs Brasilia time, from the city's earliest first vote (polls open 08:00 BRT;
// tolerant of late openings), which also covers cities off their state's usual offset.
function buildRollups(el) {
  const rows = []
  for (const [id, p] of Object.entries(manifest.tables.vt.parts).filter(([id]) => id.startsWith(`${el.key}/`))) {
    const state = id.split('/')[1]
    const cities = new Map()
    for (const line of gunzipSync(readFileSync(`${OUT}/${p.url}`)).toString().trim().split('\n')) {
      const [head, b] = line.split(',"{')
      if (head.includes('"')) throw new Error(`quoted field, rollup parser needs a CSV reader: ${head}`)
      const f = head.split(',')
      const c = cities.get(f[3]) ?? { sections: 0, n: 0, first: Infinity, b: Array(NB).fill(0) }
      cities.set(f[3], c)
      c.sections++
      c.n += +f[7]
      c.first = Math.min(c.first, +f[8])
      b.slice(0, -2).split(',').forEach((v, i) => (c.b[i] += +v))
    }
    // a late-opening section can only push the estimate up, so cap it at the state's most common value
    const est = new Map([...cities].map(([city, c]) => [city, Math.round((c.first - 8 * 3600 - 300) / 3600)]))
    const all = [...est.values()]
    const mode = [...new Set(all)].sort((a, b) => all.filter((x) => x === b).length - all.filter((x) => x === a).length)[0]
    for (const [city, c] of cities) rows.push([state, city, c.sections, c.n, FIXED_TZ[`${state}/${city}`] ?? Math.min(est.get(city), mode), `{${c.b}}`])
  }
  smallTable('vtc', el, rows)
}

// ---- results and coverage, derived from the rdv parts just written (never from the database), so rollups, section parts and the
// residual always describe the same snapshot. tot: per city/office totals; res: votes per candidate (per city for president/governor/
// senator, per UF for deputies: per-city lists would be ~1M rows); coverage: own sections (TSE state configs; sections with nsp != ns
// are aggregated into another section and have no files of their own) against the sections in the parts.
const TSE_CFG = 'https://resultados.tse.jus.br/oficial/ele2026/arquivo-urna/3220/config'
const rdvFiles = (el, uf) => Object.entries(manifest.tables.rdv.parts).filter(([id]) => id.startsWith(`${el.key}/`) && (id.split('/')[1] === uf || id.split('/')[1].startsWith(`${uf}.`))).map(([, p]) => `${OUT}/${p.url}`)
const ufsInDump = (el) => [...new Set(Object.keys(manifest.tables.rdv.parts).filter((id) => id.startsWith(`${el.key}/`)).map((id) => id.split('/')[1].split('.')[0]))].sort()

function scanRdv(el, uf) {
  const [tot, res, stored] = [new Map(), new Map(), new Set()]
  for (const file of rdvFiles(el, uf)) {
    for (const line of gunzipSync(readFileSync(file)).toString().split('\n')) {
      if (!line) continue
      const f = parseCsvLine(line)
      const [city, office] = [f[RDV.city], f[RDV.office]]
      if (office === '1') stored.add(`${city}\t${f[RDV.zone]}\t${f[RDV.section]}`)
      // blank/null ballots are NULL when the election never stored them (an empty field), never counted as 0
      const t = tot.get(`${city}\t${office}`) ?? [0, 0, f[RDV.blank] === '' ? null : 0, f[RDV.nul] === '' ? null : 0]
      tot.set(`${city}\t${office}`, [t[0] + 1, t[1] + +f[RDV.nominal], t[2] == null ? null : t[2] + +f[RDV.blank], t[3] == null ? null : t[3] + +f[RDV.nul]])
      for (const [cand, v] of Object.entries(JSON.parse(f[RDV.votes]))) {
        const key = `${+office <= 5 ? city : ''}\t${office}\t${cand}`
        res.set(key, (res.get(key) ?? 0) + v)
      }
    }
  }
  return { tot, res, stored }
}

async function ownSections(uf) {
  const cfg = await (await fetch(`${TSE_CFG}/${uf}/${uf}-p003220-cs.json`)).json()
  const own = new Set()
  let aggregated = 0
  for (const [city, zone, c] of cfg.abr.flatMap((a) => a.mu.flatMap((m) => m.zon.flatMap((z) => z.sec.map((c) => [m.nm, z.cd, c]))))) (c.nsp && c.nsp !== c.ns ? aggregated++ : own.add(`${city}\t${zone}\t${c.ns}`))
  return { own, aggregated }
}

async function buildResults(el) {
  const [tot, res, cov, missing] = [[], [], [], []]
  for (const uf of ufsInDump(el)) {
    const { tot: t, res: r, stored } = scanRdv(el, uf)
    tot.push(...[...t].map(([k, v]) => [uf, ...k.split('\t'), ...v]))
    res.push(...[...r].map(([k, v]) => { const [city, office, cand] = k.split('\t'); return [uf, city || null, office, cand, v] }))
    if (!el.hasCoverage) continue
    const { own, aggregated } = await ownSections(uf)
    const lost = [...own].filter((k) => !stored.has(k)).sort()
    cov.push([uf, own.size, stored.size, aggregated, lost.length])
    missing.push(...lost.map((k) => [uf, ...k.split('\t')]))
    log(`coverage ${uf}: own ${own.size}, stored ${stored.size}, aggregated ${aggregated}, missing ${lost.length}`)
  }
  smallTable('tot', el, tot)
  smallTable('res', el, res)
  if (el.hasCoverage) { smallTable('cov', el, cov); smallTable('miss', el, missing) }
}

// ---- candidates (names, parties, official totals) -------------------------------------------------------------------------------
const payload = async (url) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  return JSON.parse(Buffer.from((await res.text()).trim().split('.')[1], 'base64url').toString())
}

async function candidates(el, uf, office, url) {
  const { carg } = await payload(url)
  return carg[0].agr.flatMap((a) => a.par.flatMap((p) => (p.cand ?? []).map((c) => [el.year, el.turn, uf, office, c.n, c.nm, c.nmu, p.sg, c.vap ?? ''])))
}

// 2026: the TSE candidate files (with their official totals)
async function rdvCandidates(el) {
  const TSE = 'https://resultados.tse.jus.br/oficial/ele2026'
  const ufs = (await statesOf(el)).filter((u) => u !== 'zz')
  const rows = await candidates(el, 'br', 1, `${TSE}/6257/dados/br/br-c0001-e006257-u.jws`)
  for (const uf of ufs) {
    for (const office of uf === 'df' ? [3, 5, 6, 8] : [3, 5, 6, 7]) {
      rows.push(...(await candidates(el, uf, office, `${TSE}/6259/dados/${uf}/${uf}-c${String(office).padStart(4, '0')}-e006259-u.jws`)))
    }
  }
  return rows
}

// 2018/2022: the collector's `candidates` table. It has no official totals file, so the national president totals are the sum of the
// shipped section results (they equal the TSE numbers; the other offices have no total here).
async function openCandidates(el) {
  const nominal = new Map()
  for (const line of gunzipSync(readFileSync(`${OUT}/res/${el.key}.csv.gz`)).toString().split('\n').filter(Boolean)) {
    const [, , , , office, cand, votes] = parseCsvLine(line)
    if (office === '1') nominal.set(cand, (nominal.get(cand) ?? 0) + +votes)
  }
  const sql = `select distinct on (state, office, number) lower(state), office, number, name, ballot_name, party from candidates where turn = ${el.turn} order by state, office, number, sq_candidato`
  return (await text(el.source.db, [sql])).trim().split('\n').map(parseCsvLine).map(([uf, office, n, name, short, party]) => [el.year, el.turn, uf, office, n, name, short, party, uf === 'br' && office === '1' ? nominal.get(n) ?? 0 : ''])
}

async function buildCands() {
  const rows = []
  for (const el of SELECTED) rows.push(...(await (isOpen(el) ? openCandidates : rdvCandidates)(el)))
  // the other elections keep the rows already shipped (a partial run with --election=)
  const kept = manifest.tables.cands && existsSync(`${OUT}/cands.csv.gz`) ? gunzipSync(readFileSync(`${OUT}/cands.csv.gz`)).toString().split('\n').filter(Boolean).map(parseCsvLine).filter((r) => !SELECTED.some((e) => e.year === +r[0] && e.turn === +r[1])) : []
  const all = [...kept, ...rows.map((r) => r.map(String))]
  const body = csvOf(all)
  writeFileSync(`${OUT}/cands.csv.gz`, gzipSync(body, { level: 9 }))
  manifest.tables.cands = { name: 'cands', columns: 'election,turn,uf,office,n,name,short_name,party,official_votes', ddl: 'create table cands (election int, turn int, uf text, office int, n text, name text, short_name text, party text, official_votes bigint)',
    parts: { all: { url: 'cands.csv.gz', bytes: readFileSync(`${OUT}/cands.csv.gz`).length, rows: all.length, rawBytes: body.length } } }
  log(`cands: ${all.length} rows`)
}

// ---- maps and parliament -----------------------------------------------------------------------------------------------------

// municipalities renamed between elections
const RENAMED = { 'ba/CAMACÃ': 'CAMACAN', 'pa/SANTA ISABEL DO PARÁ': 'SANTA IZABEL DO PARÁ', 'pr/MUNHOZ DE MELO': 'MUNHOZ DE MELLO', 'go/BOM JESUS DE GOIÁS': 'BOM JESUS' }
const plain = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '')

// TSE municipality codes are not IBGE codes: the TSE list carries both (`cd` and `cdi`), and we join by (UF, name).
// Names that differ between elections (spelling, renamed municipalities) are matched without accents/punctuation.
async function buildMunicipalities() {
  const mun = await tseMunicipalities()
  const rows = mun.abr.flatMap((a) => a.mu.map((m) => [a.cd, m.nm, m.cdi ?? null]))
  const byName = new Map(rows.map(([s, c, i]) => [`${s}/${plain(c)}`, i]))
  const known = new Set(rows.map(([s, c]) => `${s}/${c}`))
  for (const el of Object.values(ELECTIONS)) {
    const pairs = (await text(el.source.db, [citiesSql(el)])).trim().split('\n').map((l) => l.replaceAll('"', '').split(/,(.*)/s).slice(0, 2))
    const unmatched = []
    for (const [s, c] of pairs) {
      if (known.has(`${s}/${c}`)) continue
      const ibge = byName.get(`${s}/${plain(RENAMED[`${s}/${c}`] ?? c)}`)
      ibge ? rows.push([s, c, ibge]) : unmatched.push(`${s}/${c}`)
      known.add(`${s}/${c}`)
    }
    log(`municipalities ${el.year}: ${pairs.length} in the results, ${unmatched.length} without IBGE code${unmatched.length ? `: ${unmatched.slice(0, 12).join('; ')}` : ''}`)
  }
  const body = csvOf(rows)
  writeFileSync(`${OUT}/mun_map.csv.gz`, gzipSync(body, { level: 9 }))
  manifest.tables.mun_map = { name: 'mun_map', columns: 'state,city,ibge', ddl: 'create table mun_map (state text, city text, ibge text)',
    parts: { all: { url: 'mun_map.csv.gz', bytes: readFileSync(`${OUT}/mun_map.csv.gz`).length, rows: rows.length, rawBytes: body.length } } }
  log(`mun_map: ${rows.length} rows`)
  return mun
}

async function buildGeo(mun) {
  const codeToUf = Object.fromEntries(mun.abr.filter((a) => a.cd !== 'zz').map((a) => [a.mu.find((m) => m.cdi).cdi.slice(0, 2), a.cd]))
  const geo = await buildGeometry(codeToUf)
  const write = (name, map) => {
    mkdirSync(`${OUT}/geo`, { recursive: true })
    const body = JSON.stringify(map)
    writeFileSync(`${OUT}/geo/${name}.json`, body)
    return { url: `geo/${name}.json`, bytes: body.length, items: map.items.length }
  }
  manifest.geo = { uf: write('uf', geo.uf), mun: write('mun', geo.mun), states: Object.fromEntries(Object.entries(geo.states).map(([uf, m]) => [uf, write(`mun-${uf}`, m)])), source: 'IBGE malhas v3 (qualidade minima/intermediaria)' }
  log(`geometry: ${Object.values(manifest.geo.states).reduce((t, g) => t + g.bytes, 0) + manifest.geo.uf.bytes + manifest.geo.mun.bytes} bytes`)
}

// Elected seats come from the official TSE state files (never recomputed): senators carry `e: 's'` per candidate; for
// deputies the files give the seats per party/federation (`vag`) and, once published, the elected candidates.
const OFFICES = { 5: 'senador', 6: 'deputado federal', 7: 'deputado estadual', 8: 'deputado distrital' }
const EXPECTED = { 5: 54, 6: 513, 8: 24 }

async function stateFile(uf, office, fresh) {
  const url = `https://resultados.tse.jus.br/oficial/ele2026/6259/dados/${uf}/${uf}-c${String(office).padStart(4, '0')}-e006259-u.jws`
  const body = await cached(`tse-${uf}-${office}.jws`, url, { fresh })
  return JSON.parse(Buffer.from(body.trim().split('.')[1], 'base64url').toString()).carg[0]
}

const candidatesOf = (carg) => carg.agr.flatMap((a) => a.par.flatMap((p) => (p.cand ?? []).map((c) => ({ ...c, party: p.sg, bloc: a.com }))))

// 2018/2022: the collector's `elected` table; seats count the elected candidates per party (no federation blocs)
async function buildElectedOpen(el) {
  const won = `from elected e left join candidates c on c.sq_candidato = e.sq_candidato and c.turn = e.turn where e.turn = ${el.turn} and e.outcome like 'ELEITO%'`
  const elected = (await text(el.source.db, [`select lower(e.state), e.office, e.number, coalesce(c.ballot_name, e.name), e.party, e.outcome, e.votes ${won} and e.office = 5 order by 1, e.votes desc`])).trim().split('\n').map(parseCsvLine)
  const seats = (await text(el.source.db, [`select lower(e.state), e.office, e.party, count(*) ${won} and e.office in (5, 6, 7, 8) group by 1, 2, 3 order by 1, 2, 4 desc`])).trim().split('\n').map(parseCsvLine)
  for (const office of [5, 6, 7, 8]) log(`seats ${el.key} office ${office}: ${seats.filter((r) => +r[1] === office).reduce((t, r) => t + +r[3], 0)}`)
  smallTable('elected', el, elected)
  smallTable('seats', el, seats)
}

async function buildElected(el, mun) {
  if (isOpen(el)) return buildElectedOpen(el)
  const [elected, seats] = [[], []]
  const ufs = mun.abr.map((a) => a.cd).filter((u) => u !== 'zz')
  for (const uf of ufs) {
    for (const office of uf === 'df' ? [5, 6, 8] : [5, 6, 7]) {
      const carg = await stateFile(uf, office, true)
      const won = candidatesOf(carg).filter((c) => c.e === 's')
      elected.push(...won.map((c) => [uf, office, c.n, c.nmu ?? c.nm, c.party, c.st, c.vap]))
      if (office === 5) seats.push(...Object.entries(Object.groupBy(won, (c) => c.party)).map(([p, l]) => [uf, 5, p, l.length]))
      else seats.push(...carg.agr.filter((a) => +a.vag > 0).map((a) => [uf, office, a.com, +a.vag]))
    }
  }
  for (const office of Object.keys(OFFICES)) {
    const total = seats.filter((r) => r[1] === +office).reduce((t, r) => t + r[3], 0)
    log(`seats office ${office} (${OFFICES[office]}): ${total}${EXPECTED[office] && total !== EXPECTED[office] ? ` != expected ${EXPECTED[office]}` : ''}, elected candidates listed: ${elected.filter((r) => r[1] === +office).length}`)
  }
  smallTable('elected', el, elected)
  smallTable('seats', el, seats)
}

// ---- residual: official zone/municipality totals minus what the dump has ------------------------------------------------------
// Sections whose files the TSE never published are missing from the dump, but the official result files count them. For every zone
// with missing sections the residual is official zone total minus what the shipped parts hold, per candidate (and blank/null); the city
// residual used by the rollups is the sum of its zones. Nothing is invented: if any zone file of a city/office is missing, not fully
// totalized or would give a negative residual, the city-level residual is used for that city/office instead (and the zone is listed in
// residual_skipped with the reason); if that fails too, no residual is stored for it.
async function buildResidual(el, mun) {
  const codes = new Map(mun.abr.flatMap((a) => a.mu.map((m) => [`${a.cd}/${m.nm}`, m.cd])))
  const missing = new Map() // "uf/city" -> Map(zone -> missing sections)
  for (const l of gunzipSync(readFileSync(`${OUT}/miss/${el.key}.csv.gz`)).toString().trim().split('\n')) {
    const [, , uf, city, zone] = parseCsvLine(l)
    const zones = missing.get(`${uf}/${city}`) ?? new Map()
    missing.set(`${uf}/${city}`, zones.set(zone, (zones.get(zone) ?? 0) + 1))
  }
  const [rows, skipped, fallbacks] = [[], [], []]
  for (const uf of [...new Set([...missing.keys()].map((k) => k.split('/')[0]))].sort()) {
    const cities = [...missing].filter(([k]) => k.startsWith(`${uf}/`)).map(([k, zones]) => [k.slice(uf.length + 1), zones])
    const dump = dumpOf(rdvFiles(el, uf), new Set(cities.map(([c]) => c)))
    for (const [city, zones] of cities) {
      const code = codes.get(`${uf}/${city}`)
      for (const office of officesOf(uf)) {
        const attempt = async (zone) => {
          try { return residualOf(await officialFile(el.year, uf, code, zone, office), (zone ? dump.zones.get(`${city}|${zone}|${office}`) : dump.cities.get(`${city}|${office}`)) ?? EMPTY) } catch (e) { return { skip: 'no_official_file', detail: e.message.slice(-40) } }
        }
        const results = await Promise.all([...zones.keys()].map(async (zone) => [zone, await attempt(zone)]))
        const failed = results.filter(([, r]) => r.skip)
        failed.forEach(([zone, r]) => skipped.push([uf, city, zone, office, r.skip, r.detail]))
        const whole = await attempt(null)
        const zoneRows = results.flatMap(([zone, r]) => (r.rows ?? []).map(([number, votes]) => [uf, city, code, zone, office, number, votes, zones.get(zone)]))
        // zone files and the city file are published at different moments: the zone residuals are used only if they add up to the city's
        const sum = zoneRows.reduce((m, r) => m.set(r[5], (m.get(r[5]) ?? 0) + r[6]), new Map())
        const agree = !whole.skip && whole.rows.length === sum.size && whole.rows.every(([n, v]) => sum.get(n) === v)
        if (!failed.length && (agree || whole.skip)) { rows.push(...zoneRows); continue }
        if (!failed.length) skipped.push([uf, city, '', office, 'zone_files_disagree', `zone residuals add up to ${[...sum.values()].reduce((t, v) => t + v, 0)} votes, the city file to ${whole.rows.reduce((t, [, v]) => t + v, 0)}`])
        if (whole.skip) { skipped.push([uf, city, '', office, whole.skip, `city fallback: ${whole.detail}`]); continue }
        fallbacks.push(`${uf}/${city}/${office}`)
        rows.push(...whole.rows.map(([number, votes]) => [uf, city, code, '', office, number, votes, [...zones.values()].reduce((t, n) => t + n, 0)]))
      }
    }
    log(`residual ${uf}: ${cities.length} cities, ${rows.filter((r) => r[0] === uf).length} rows, ${skipped.filter((r) => r[0] === uf).length} skipped zone/office pairs`)
  }
  log(`residual: ${fallbacks.length} city/office pairs fell back to city level${fallbacks.length ? `: ${[...new Set(fallbacks.map((f) => f.split('/').slice(0, 2).join('/')))].join(', ')}` : ''}`)
  smallTable('residual', el, rows)
  smallTable('residual_skipped', el, skipped)
}

mkdirSync(OUT, { recursive: true })
for (const el of SELECTED) {
  if (ONLY.includes('rdv')) await buildRdv(el)
  if (el.hasTimes && ONLY.includes('vt')) { await buildVt(el); buildRollups(el) }
  if (ONLY.includes('results')) await buildResults(el)
}
if (ONLY.includes('cands')) await buildCands()
if (['geo', 'elected', 'residual'].some((k) => ONLY.includes(k)) || !manifest.tables.mun_map) {
  const mun = await buildMunicipalities()
  if (ONLY.includes('geo')) await buildGeo(mun)
  for (const el of SELECTED) {
    if (el.hasSeats && ONLY.includes('elected')) await buildElected(el, mun)
    if (el.hasResidual && ONLY.includes('residual')) await buildResidual(el, mun)
  }
}
manifest.version = new Date().toISOString()
writeFileSync(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 1) + '\n')
log('manifest written')
