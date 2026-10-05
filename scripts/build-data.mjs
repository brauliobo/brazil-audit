// Builds the shippable dump in data/ from the local read-only Postgres databases (via psql) and the TSE candidate files.
//   nice -n 10 node scripts/build-data.mjs [--election=2022,2026] [--states=ac,ro] [--only=votes,rdv,vt,rollups,results,cands]  (rollups = city voting-time sums, rebuilt with vt)
// Output: data/manifest.json + gzip CSV parts partitioned by state (loaded into PGlite with COPY ... FROM '/dev/blob').
// Parts of unselected states are kept, so single states can be refreshed.
import { spawn } from 'node:child_process'
import { createGzip, gunzipSync, gzipSync } from 'node:zlib'
import { createWriteStream, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'

const opt = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')))
const list = (k, all) => (opt[k] ? opt[k].split(',') : all)
const ELECTIONS = list('election', ['2022', '2026'])
const ONLY = list('only', ['votes', 'rdv', 'vt', 'results', 'cands'])
const DB = { 2022: 'brazil-audit', 2026: 'brazil-audit-2026' }
const OUT = 'data'
const T0 = 18000 // time-of-day buckets: 05:00 local clock, 10 minutes each, 90 buckets (05:00-20:00), edges clamped
const STEP = 600
const NB = 90

// Fernando de Noronha runs on UTC-2 but its polls still open at 08:00 BRT (09:00 on its clock): the estimate below would be capped to 0
const FIXED_TZ = { 'pe/FERNANDO DE NORONHA': 1 }

const q = (s) => `'${s.replaceAll("'", "''")}'`
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const manifest = existsSync(`${OUT}/manifest.json`) ? JSON.parse(readFileSync(`${OUT}/manifest.json`, 'utf8')) : { elections: {} }

function psql(db, script) {
  const env = { ...process.env, PGOPTIONS: '-c statement_timeout=900000 -c client_min_messages=error' }
  const p = spawn('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', db], { env })
  // the 2022 database warns about a harmless collation version mismatch on every connection
  p.stderr.on('data', (d) => process.stderr.write(d.toString().split('\n').filter((l) => l && !/collation/.test(l)).join('\n')))
  const done = new Promise((res, rej) => p.on('close', (c) => (c ? rej(new Error(`psql exited ${c}`)) : res())))
  p.stdin.end(script)
  return { out: p.stdout, done }
}

const scalar = async (db, sql) => {
  const { out, done } = psql(db, `\\copy (${sql}) to stdout csv\n`)
  const chunks = []
  for await (const c of out) chunks.push(c)
  await done
  return Buffer.concat(chunks).toString().trim().split('\n').filter(Boolean).map((l) => l.replace(/^"|"$/g, ''))
}

const copy = (queries) => queries.map((x) => `\\copy (${x.replace(/\s+/g, ' ')}) to stdout csv\n`).join('')

async function text(db, queries) {
  const { out, done } = psql(db, copy(queries))
  const chunks = []
  for await (const c of out) chunks.push(c)
  await done
  return Buffer.concat(chunks).toString()
}

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

function part(tableDef, key, file, stats, extra = {}) {
  if (!stats.rows) { unlinkSync(file); delete tableDef.parts[key]; return }
  const bytes = readFileSync(file).length
  if (bytes > 50e6) console.warn(`WARNING ${file} is ${bytes} bytes, above the 50 MB part target`)
  tableDef.parts[key] = { url: file.replace(`${OUT}/`, ''), bytes, ...stats, ...extra }
  log(`${tableDef.name}/${key}: ${stats.rows} rows, raw ${stats.rawBytes}, gz ${bytes}`)
}

const table = (election, name, columns, ddl, extra = {}) => {
  const e = (manifest.elections[election] ??= { tables: {} })
  const t = (e.tables[name] ??= { parts: {} })
  Object.assign(t, { name, columns, ddl, ...extra })
  return t
}

async function build2022() {
  const t = table('2022', 'votes_2022', 'state,city,zone,section,model,votes_13,votes_22',
    'create table votes_2022 (state text, city text, zone text, section text, model text, votes_13 int, votes_22 int)')
  for (const s of list('states', await scalar(DB[2022], 'select distinct state from votes order by 1'))) {
    const file = `2022/votes/${s}.csv.gz`
    const sql = `select state,city,zone,section,model,votes_13,votes_22 from votes where state=${q(s)} order by city,zone,section,model`
    part(t, s, `${OUT}/${file}`, await dump(DB[2022], [sql], `${OUT}/${file}`))
  }
}

// section totals per kind (2 nominal, 3 blank, 4 invalid number, 6 null; the TSE site counts 4 and 6 as null)
const sumOf = (...kinds) => kinds.map((k) => `(select coalesce(sum(value::int),0) from jsonb_each_text(votes->'${k}'))`).join('+')
// one lazy part per office group: president/governor/senator together, each deputy office on its own (the bulk of the bytes)
const OFFICE_PARTS = { main: [1, 3, 5], 6: [6], 7: [7], 8: [8] }
const rdvSql = (s, offices) => `select state,city,zone,section,model,office,${sumOf(2)},${sumOf(3)},${sumOf(4, 6)},
  coalesce(votes->'2','{}'::jsonb) from rdv_votes where state=${q(s)} and office in (${offices}) order by city,zone,section,model,office`

// per city and office totals / per candidate votes (deputies per state only, their per-city lists would be ~1M rows)
const totSql = (s) => `select state,city,office,count(*),sum(n),sum(b),sum(u) from (select state,city,office,${sumOf(2)} n,${sumOf(3)} b,${sumOf(4, 6)} u
  from rdv_votes where state=${q(s)}) t group by 1,2,3`
const resSql = (s) => [
  `select r.state,r.city,r.office,e.key,sum(e.value::int) from rdv_votes r, jsonb_each_text(r.votes->'2') e where r.state=${q(s)} and r.office in (1,3,5) group by 1,2,3,4`,
  `select r.state,null,r.office,e.key,sum(e.value::int) from rdv_votes r, jsonb_each_text(r.votes->'2') e where r.state=${q(s)} and r.office in (6,7,8) group by 1,2,3,4`,
]

const buckets = Array.from({ length: NB }, (_, i) => `count(*) filter (where bk=${i})`).join(',')
// One index probe per section (state,city,zone,section,model,post prefix): ~300x faster than scanning the city's range
// and filtering post, because the index puts post after model. Sections come from rdv_votes (the scraped results).
const vtSql = (s, city) => `with e as (select sec.zone,sec.section,sec.model,x.sc,x.sc-lag(x.sc) over (partition by sec.zone,sec.section,sec.model order by x.time) gap
  from (select zone,section,model from rdv_votes where state=${q(s)} and city=${q(city)} and office=1) sec
  cross join lateral (select time,(extract(epoch from time)::bigint % 86400)::int sc from voting_times v where v.state=${q(s)} and v.city=${q(city)}
    and v.zone=sec.zone and v.section=sec.section and v.model=sec.model and v.post='Presidente') x),
  b as (select *,least(greatest((sc-${T0})/${STEP},0),${NB - 1}) bk from e)
  select ${q(s)},${q(city)},zone,section,model,count(*),min(sc),max(sc),round(percentile_cont(.5) within group (order by gap)),
  round(percentile_cont(.1) within group (order by gap)),round(percentile_cont(.9) within group (order by gap)),max(gap),
  '{'||concat_ws(',',${buckets})||'}' from b group by zone,section,model order by zone,section,model`

const allStates2026 = () => scalar(DB[2026], 'select distinct state from rdv_votes order by 1')
const states2026 = async () => list('states', await allStates2026())
const elapsed = (t0) => `${((Date.now() - t0) / 60000).toFixed(1)} min`

async function build2026() {
  const rdv = table('2026', 'rdv_2026', 'state,city,zone,section,model,office,nominal,blank,nul,votes',
    'create table rdv_2026 (state text, city text, zone text, section text, model text, office int, nominal int, blank int, nul int, votes jsonb)')
  const vt = table('2026', 'vt_2026', 'state,city,zone,section,model,n,first,last,med,p10,p90,maxgap,b',
    'create table vt_2026 (state text, city text, zone text, section text, model text, n int, first int, last int, med int, p10 int, p90 int, maxgap int, b smallint[])',
    { time: { t0: T0, step: STEP, buckets: NB, clock: 'local clock as recorded by the scraper' } })
  const t0 = Date.now()
  for (const s of await states2026()) {
    if (ONLY.includes('rdv')) {
      for (const [group, offices] of Object.entries(OFFICE_PARTS)) {
        const key = group === 'main' ? s : `${s}.${group}`
        const file = `${OUT}/2026/rdv/${key}.csv.gz`
        part(rdv, key, file, await dump(DB[2026], [rdvSql(s, offices)], file), { where: `state = ${q(s)} and office in (${offices})`, offices })
      }
    }
    if (ONLY.includes('vt')) {
      const cities = await scalar(DB[2026], `select distinct city from rdv_votes where state=${q(s)} and office=1 order by 1`)
      const file = `${OUT}/2026/vt/${s}.csv.gz`
      part(vt, s, file, await dump(DB[2026], cities.map((c) => vtSql(s, c)), file))
    }
    log(`${s} done, ${elapsed(t0)} since start`)
  }
}

// Result rollups (small, always loaded): tot_2026 per city/office totals, res_2026 per candidate votes.
async function buildResults() {
  const [tot, res] = [[], []]
  for (const s of await allStates2026()) {
    tot.push(await text(DB[2026], [totSql(s)]))
    res.push(await text(DB[2026], resSql(s)))
    log(`results ${s}`)
  }
  for (const [name, cols, ddl, body] of [
    ['tot_2026', 'state,city,office,sections,nominal,blank,nul', 'create table tot_2026 (state text, city text, office int, sections int, nominal bigint, blank bigint, nul bigint)', tot],
    ['res_2026', 'state,city,office,cand,votes', 'create table res_2026 (state text, city text, office int, cand text, votes bigint)', res],
  ]) {
    const csv = body.join('')
    const gz = gzipSync(csv, { level: 9 })
    writeFileSync(`${OUT}/2026/${name}.csv.gz`, gz)
    const t = table('2026', name, cols, ddl)
    t.parts.all = { url: `2026/${name}.csv.gz`, bytes: gz.length, rows: csv.split('\n').length - 1, rawBytes: csv.length }
    log(`${name}: ${t.parts.all.rows} rows, ${gz.length} bytes gz`)
  }
}

// Coverage: own sections (TSE state configs; sections with nsp != ns are aggregated into another section and have no
// files of their own) against the sections stored in rdv_votes. Missing = own but not stored (TSE never published them).
const TSE_CFG = 'https://resultados.tse.jus.br/oficial/ele2026/arquivo-urna/3220/config'
async function buildCoverage() {
  const cov = [], missing = []
  for (const s of await allStates2026()) {
    const cfg = await (await fetch(`${TSE_CFG}/${s}/${s}-p003220-cs.json`)).json()
    const own = new Set(), aggregated = [0]
    const sections = cfg.abr.flatMap((a) => a.mu.flatMap((m) => m.zon.flatMap((z) => z.sec.map((c) => [m.nm, z.cd, c]))))
    for (const [city, zone, c] of sections) (c.nsp && c.nsp !== c.ns ? aggregated[0]++ : own.add(`${city}\t${zone}\t${c.ns}`))
    const stored = new Set((await text(DB[2026], [`select distinct city,zone,section from rdv_votes where state=${q(s)} and office=1`])).trim().split('\n').map((l) => l.replaceAll('"', '').split(',').join('\t')))
    const lost = [...own].filter((k) => !stored.has(k)).sort()
    cov.push([s, own.size, stored.size, aggregated[0], lost.length])
    missing.push(...lost.map((k) => [s, ...k.split('\t')]))
    log(`coverage ${s}: own ${own.size}, stored ${stored.size}, aggregated ${aggregated[0]}, missing ${lost.length}`)
  }
  const csv = (rows) => rows.map((r) => r.map((v) => (/[,"]/.test(v) ? `"${v}"` : v)).join(',')).join('\n') + '\n'
  for (const [name, cols, ddl, rows] of [
    ['cov_2026', 'state,own,stored,aggregated,missing', 'create table cov_2026 (state text, own int, stored int, aggregated int, missing int)', cov],
    ['miss_2026', 'state,city,zone,section', 'create table miss_2026 (state text, city text, zone text, section text)', missing],
  ]) {
    const body = csv(rows)
    const gz = gzipSync(body, { level: 9 })
    writeFileSync(`${OUT}/2026/${name}.csv.gz`, gz)
    table('2026', name, cols, ddl).parts.all = { url: `2026/${name}.csv.gz`, bytes: gz.length, rows: rows.length, rawBytes: body.length }
  }
}

// City rollups of the section buckets (so state/country charts never scan the section tables), always rebuilt from the
// vt parts on disk. `tz` = estimated hours of the recorded local clock vs Brasilia time, from the city's earliest first vote
// (polls open 08:00 BRT; tolerant of late openings), which also covers cities off their state's usual offset.
function buildRollups() {
  const rows = []
  for (const [state, p] of Object.entries(manifest.elections['2026'].tables.vt_2026.parts)) {
    const cities = new Map()
    for (const line of gunzipSync(readFileSync(`${OUT}/${p.url}`)).toString().trim().split('\n')) {
      const [head, b] = line.split(',"{')
      if (head.includes('"')) throw new Error(`quoted field, rollup parser needs a CSV reader: ${head}`)
      const [, city, , , , n, first] = head.split(',')
      const c = cities.get(city) ?? { sections: 0, n: 0, first: Infinity, b: Array(NB).fill(0) }
      cities.set(city, c)
      c.sections++
      c.n += +n
      c.first = Math.min(c.first, +first)
      b.slice(0, -2).split(',').forEach((v, i) => (c.b[i] += +v))
    }
    // a late-opening section can only push the estimate up, so cap it at the state's most common value
    const est = new Map([...cities].map(([city, c]) => [city, Math.round((c.first - 8 * 3600 - 300) / 3600)]))
    const all = [...est.values()]
    const mode = [...new Set(all)].sort((a, b) => all.filter((x) => x === b).length - all.filter((x) => x === a).length)[0]
    for (const [city, c] of cities) rows.push([state, city, c.sections, c.n, FIXED_TZ[`${state}/${city}`] ?? Math.min(est.get(city), mode), `{${c.b}}`])
  }
  const csv = rows.map((r) => r.map((v) => (/[,"]/.test(v) ? `"${v}"` : v)).join(',')).join('\n') + '\n'
  const gz = gzipSync(csv, { level: 9 })
  writeFileSync(`${OUT}/2026/vtc.csv.gz`, gz)
  const t = table('2026', 'vtc_2026', 'state,city,sections,n,tz,b', 'create table vtc_2026 (state text, city text, sections int, n int, tz int, b int[])')
  t.parts.all = { url: '2026/vtc.csv.gz', bytes: gz.length, rows: rows.length, rawBytes: csv.length }
  log(`vtc_2026: ${rows.length} cities, ${gz.length} bytes gz`)
}

const payload = async (url) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  return JSON.parse(Buffer.from((await res.text()).trim().split('.')[1], 'base64url').toString())
}

async function candidates(election, uf, office, url) {
  const { carg } = await payload(url)
  return carg[0].agr.flatMap((a) => a.par.flatMap((p) => (p.cand ?? []).map((c) => [election, uf, office, c.n, c.nm, c.nmu, p.sg, c.vap ?? ''])))
}

async function buildCands() {
  const TSE = 'https://resultados.tse.jus.br/oficial/ele2026'
  const ufs = (await scalar(DB[2022], 'select distinct state from votes order by 1')).filter((u) => u !== 'zz')
  const rows = [
    ...(await candidates(2026, 'br', 1, `${TSE}/6257/dados/br/br-c0001-e006257-u.jws`)),
    // 2022 runoff, official totals
    [2022, 'br', 1, '13', 'LUIZ INÁCIO LULA DA SILVA', 'LULA', 'PT', 60345999],
    [2022, 'br', 1, '22', 'JAIR MESSIAS BOLSONARO', 'BOLSONARO', 'PL', 58206354],
  ]
  for (const uf of ufs) {
    for (const office of uf === 'df' ? [3, 5, 6, 8] : [3, 5, 6, 7]) {
      rows.push(...(await candidates(2026, uf, office, `${TSE}/6259/dados/${uf}/${uf}-c${String(office).padStart(4, '0')}-e006259-u.jws`)))
    }
  }
  const csv = rows.map((r) => r.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(',')).join('\n') + '\n'
  const gz = createGzip({ level: 9 })
  mkdirSync(OUT, { recursive: true })
  const out = createWriteStream(`${OUT}/cands.csv.gz`)
  gz.pipe(out)
  gz.end(csv)
  await new Promise((r) => out.on('close', r))
  manifest.cands = { name: 'cands', columns: 'election,uf,office,n,name,short_name,party,official_votes', url: 'cands.csv.gz', rows: rows.length, bytes: readFileSync(`${OUT}/cands.csv.gz`).length,
    ddl: 'create table cands (election int, uf text, office int, n text, name text, short_name text, party text, official_votes int)' }
  log(`cands: ${rows.length} rows`)
}

mkdirSync(OUT, { recursive: true })
if (ELECTIONS.includes('2022') && ONLY.includes('votes')) await build2022()
if (ELECTIONS.includes('2026') && (ONLY.includes('rdv') || ONLY.includes('vt'))) await build2026()
if (ELECTIONS.includes('2026') && ONLY.includes('results')) { await buildResults(); await buildCoverage() }
if (ELECTIONS.includes('2026') && (ONLY.includes('vt') || ONLY.includes('rollups'))) buildRollups()
if (ONLY.includes('cands')) await buildCands()
manifest.version = new Date().toISOString()
writeFileSync(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 1) + '\n')
log('manifest written')
