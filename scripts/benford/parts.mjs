// Turns scopes into the rows of the three shipped tables and writes them as lazy gzip CSV parts registered in the manifest
// (data/<table>/<election key>-<part>.csv.gz, part ids `<election key>/<part>`, like the other tables of the shared schema).
//   benford_hist(election, turn, office, unit, uf, city, cand, pos, digit, n)                 observed digit counts
//   benford_base(election, turn, office, unit, uf, city, cand, pos, digit, mean, lo, hi, reps) simulated baseline per digit (proportions)
//   benford_stat(election, turn, office, unit, uf, city, cand, pos, stat, mean, lo, hi, reps)  simulated baseline of MAD and chi-square
// unit: section | city | uf. uf: a UF or 'br'. city: null unless the place is a municipality. cand: candidate number, party block pN,
// or the section totals nominal / branco / nulo. pos: d1 | d2 | d12 | d_last.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { DIGITS } from '../../src/benford/stats.js'

const PLACE = 'election int, turn int, office int, unit text, uf text, city text, cand text, pos text'
export const TABLES = {
  benford_hist: { columns: 'election,turn,office,unit,uf,city,cand,pos,digit,n', ddl: `create table benford_hist (${PLACE}, digit int, n int)` },
  benford_base: { columns: 'election,turn,office,unit,uf,city,cand,pos,digit,mean,lo,hi,reps', ddl: `create table benford_base (${PLACE}, digit int, mean real, lo real, hi real, reps int)` },
  benford_stat: { columns: 'election,turn,office,unit,uf,city,cand,pos,stat,mean,lo,hi,reps', ddl: `create table benford_stat (${PLACE}, stat text, mean real, lo real, hi real, reps int)` },
}

const fixed = (decimals) => (x) => Number(x.toFixed(decimals))
const csv = (v) => (v == null ? '' : /[,"\n]/.test(v) ? `"${String(v).replaceAll('"', '""')}"` : v)
const place = (e, s) => [e.year, e.turn, s.office, s.unit, s.uf, s.city, s.cand, s.pos]

/** Decimals of a proportion: an envelope is as wide as the sampling noise, so small places need fewer (this keeps the parts small). */
const decimals = (s) => (s.city != null ? 3 : s.uf === 'br' ? 5 : 4)

export const histRows = (e, scopes) => scopes.flatMap((s) => s.counts.map((n, i) => [...place(e, s), DIGITS[s.pos][i], n]))
export const baseRows = (e, scopes, reps) => scopes.flatMap((s) => s.digits.map((d, i) => [...place(e, s), DIGITS[s.pos][i], ...[d.mean, d.lo, d.hi].map(fixed(decimals(s))), reps]))
const STATS = { mad: fixed(4), chi2: fixed(1) }
export const statRows = (e, scopes, reps) => scopes.flatMap((s) => Object.keys(STATS).filter((stat) => stat === 'mad' || s.city == null).map((stat) => [...place(e, s), stat, ...['mean', 'lo', 'hi'].map((k) => STATS[stat](s[stat][k])), reps]))

// the national part also carries the UF places of d1/d2/d_last (the UF x digit heatmap needs all of them at once)
const inNational = (r) => r[4] === 'br' || (r[3] === 'section' && r[5] == null && r[7] !== 'd12')
const partOf = (r) => (inNational(r) ? 'br' : r[4])
const NATIONAL = `(uf = 'br' or (unit = 'section' and city is null and pos <> 'd12'))`
const whereOf = (el, part) => `election = ${el.year} and turn = ${el.turn} and ${part === 'br' ? NATIONAL : `uf = '${part}' and not ${NATIONAL}`}`

/** Writes the parts of one table for one election (el: { key, year, turn }) and returns their manifest entries { '<key>/<part>': { url, bytes, rows, rawBytes, where } }. */
export function writeParts(root, el, table, rows) {
  const dir = `${root}/${table}`
  mkdirSync(dir, { recursive: true })
  for (const f of readdirSync(dir).filter((f) => f.startsWith(`${el.key}-`))) rmSync(`${dir}/${f}`)
  const parts = {}
  for (const [part, list] of Map.groupBy(rows, partOf)) {
    const body = list.map((r) => r.map(csv).join(',')).join('\n') + '\n'
    const gz = gzipSync(body, { level: 9 })
    writeFileSync(`${dir}/${el.key}-${part}.csv.gz`, gz)
    parts[`${el.key}/${part}`] = { url: `${table}/${el.key}-${part}.csv.gz`, bytes: gz.length, rows: list.length, rawBytes: body.length, where: whereOf(el, part) }
  }
  return parts
}

/** Registers the tables in the manifest (parts of the elections not rebuilt are kept); `params` documents what was built. */
export function register(manifest, built, params) {
  for (const [name, t] of Object.entries(TABLES)) {
    const old = manifest.tables[name]?.parts ?? {}
    const kept = Object.fromEntries(Object.entries(old).filter(([id]) => !built.keys.includes(id.split('/')[0])))
    manifest.tables[name] = { name, columns: t.columns, ddl: t.ddl, params, parts: { ...kept, ...built.parts[name] } }
  }
}
