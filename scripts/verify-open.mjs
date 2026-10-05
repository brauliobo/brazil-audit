// Checks the shipped data of an election of the 2018/2022 collector (both rounds) against the TSE candidate totals that its source database
// carries (`elected.votes`, from the official votacao_candidato_munzona files): for every elected candidate the votes summed from the
// shipped section results must equal the official total. For the elections whose numbers come from the machines' RDV (source kind
// 'machine') small shortfalls are the documented differences of `sources.differences` (sections missing from the RDV): they are
// listed, not failed, as long as the shipped votes never exceed the official ones.
//   node scripts/verify-open.mjs [--election=2022-2]
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { ELECTIONS } from '../src/elections.js'
import { parseCsvLine } from './csv.mjs'

const key = process.argv.find((a) => a.startsWith('--election='))?.split('=')[1] ?? '2022'
const el = ELECTIONS[key]
if (!['open', 'machine'].includes(el?.source.kind)) throw new Error(`election ${key}: not an election of the 2018/2022 collector (see src/elections.js)`)
const documented = Object.keys(el.sources.differences).length > 0

const ours = new Map()
for (const line of gunzipSync(readFileSync(`data/res/${el.key}.csv.gz`)).toString().trim().split('\n')) {
  const [, , uf, , office, cand, votes] = parseCsvLine(line)
  for (const where of office === '1' ? [uf, 'br'] : [uf]) ours.set(`${where}/${office}/${cand}`, (ours.get(`${where}/${office}/${cand}`) ?? 0) + +votes) // the president is also a national total
}

const sql = `select lower(state), office, number, votes from elected where turn = ${el.turn} and outcome like 'ELEITO%'`
const rows = execFileSync('psql', ['-X', '-q', '-At', '-F', ',', '-d', el.source.db, '-c', sql], { encoding: 'utf8' }).trim().split('\n').map((l) => l.split(','))
const gap = ([uf, office, n, votes]) => +votes - (ours.get(`${uf}/${office}/${n}`) ?? 0) // official minus shipped
const differing = rows.filter((r) => gap(r) !== 0)
const bad = documented ? differing.filter((r) => gap(r) < 0) : differing
const byOffice = Object.groupBy(rows, (r) => r[1])
console.log(`${key}: ${rows.length - differing.length} of ${rows.length} elected candidates match the official totals (${Object.entries(byOffice).map(([o, l]) => `office ${o}: ${l.length}`).join(', ')})`)
if (documented) console.log(`  ${differing.length} with a documented shortfall (sections missing from the RDV): ${differing.reduce((t, r) => t + gap(r), 0)} votes in total, largest ${Math.max(0, ...differing.map(gap))}`)
for (const r of bad.slice(0, 20)) console.log(`  MISMATCH ${r[0]} office ${r[1]} #${r[2]}: official ${r[3]}, shipped ${ours.get(`${r[0]}/${r[1]}/${r[2]}`) ?? 0}`)
if (bad.length) process.exit(1)
