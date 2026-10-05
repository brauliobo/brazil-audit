// Checks the shipped data of an open-data election (2018, 2022; both rounds) against the TSE candidate totals that its source database
// carries (`elected.votes`, from the official votacao_candidato_munzona files): for every elected candidate the votes summed from the
// shipped section results must equal the official total.
//   node scripts/verify-open.mjs [--election=2022-2]
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { ELECTIONS } from '../src/elections.js'
import { parseCsvLine } from './csv.mjs'

const key = process.argv.find((a) => a.startsWith('--election='))?.split('=')[1] ?? '2022'
const el = ELECTIONS[key]
if (el?.source.kind !== 'open') throw new Error(`election ${key}: not an open-data election (see src/elections.js)`)

const ours = new Map()
for (const line of gunzipSync(readFileSync(`data/res/${el.key}.csv.gz`)).toString().trim().split('\n')) {
  const [, , uf, , office, cand, votes] = parseCsvLine(line)
  for (const where of office === '1' ? [uf, 'br'] : [uf]) ours.set(`${where}/${office}/${cand}`, (ours.get(`${where}/${office}/${cand}`) ?? 0) + +votes) // the president is also a national total
}

const sql = `select lower(state), office, number, votes from elected where turn = ${el.turn} and outcome like 'ELEITO%'`
const rows = execFileSync('psql', ['-X', '-q', '-At', '-F', ',', '-d', el.source.db, '-c', sql], { encoding: 'utf8' }).trim().split('\n').map((l) => l.split(','))
const bad = rows.filter(([uf, office, n, votes]) => (ours.get(`${uf}/${office}/${n}`) ?? 0) !== +votes)
const byOffice = Object.groupBy(rows, (r) => r[1])
console.log(`${key}: ${rows.length - bad.length} of ${rows.length} elected candidates match the official totals (${Object.entries(byOffice).map(([o, l]) => `office ${o}: ${l.length}`).join(', ')})`)
for (const [uf, office, n, votes] of bad.slice(0, 20)) console.log(`  MISMATCH ${uf} office ${office} #${n}: official ${votes}, shipped ${ours.get(`${uf}/${office}/${n}`) ?? 0}`)
if (bad.length) process.exit(1)
