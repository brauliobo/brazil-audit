// Checks the raw-data resolver (src/raw.js) on random sections of an election: every section of the shipped dump must resolve to an
// rdv, a logs and an aux asset of the release index; when the release zips are on disk (RAW_ZIP_DIR, default /srv/release-staging) the
// section's files must really be inside the zip it points to.
//   node scripts/check-raw.mjs [--election=2026] [--sample=500] [--listed=12]
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { ELECTIONS } from '../src/elections.js'
import { findAssets, sectionId } from '../src/raw.js'
import { parseCsvLine } from './csv.mjs'

const arg = (name, fallback) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback
const key = arg('election', '2026')
const [sample, listed] = [+arg('sample', 500), +arg('listed', 12)]
const el = ELECTIONS[key]
if (!el?.raw.tag) throw new Error(`election ${key}: no raw release configured (see src/elections.js)`)
const raw = JSON.parse(readFileSync(`data/raw/${key}.json`, 'utf8'))
const zips = process.env.RAW_ZIP_DIR ?? '/srv/release-staging'

const lines = (file) => gunzipSync(readFileSync(file)).toString().trim().split('\n')
const tse = new Map(lines('data/mun_map.csv.gz').map(parseCsvLine).map(([s, c, , code]) => [`${s}/${c}`, code]))
const sections = []
for (const [id, p] of Object.entries(JSON.parse(readFileSync('data/manifest.json', 'utf8')).tables.rdv.parts)) {
  if (!id.startsWith(`${key}/`) || id.includes('.')) continue // president/governor/senator parts: one row per section and office
  for (const line of lines(`data/${p.url}`)) {
    const f = parseCsvLine(line)
    if (f[7] === '1') sections.push({ uf: f[2], city: f[3], zone: f[4], section: f[5] })
  }
}
const pick = Array.from({ length: sample }, () => sections[Math.floor(Math.random() * sections.length)])

const unresolved = []
const listing = new Map()
const entries = (name) => listing.get(name) ?? listing.set(name, new Set(execFileSync('unzip', ['-Z1', `${zips}/${name}`], { encoding: 'utf8', maxBuffer: 1 << 28 }).split('\n'))).get(name)
let inZip = 0
for (const s of pick) {
  const code = tse.get(`${s.uf}/${s.city}`)
  const id = sectionId(s.uf, code, s.zone, s.section)
  const assets = findAssets(raw, id)
  if (!code || !assets.rdv || !assets.logs || !assets.aux) unresolved.push(`${s.uf}/${s.city}/${s.zone}/${s.section} ${id}`)
}
const local = pick.slice(0, listed).filter((s) => existsSync(`${zips}/${findAssets(raw, sectionId(s.uf, tse.get(`${s.uf}/${s.city}`), s.zone, s.section)).rdv?.name}`))
for (const s of local) {
  const id = sectionId(s.uf, tse.get(`${s.uf}/${s.city}`), s.zone, s.section)
  const assets = findAssets(raw, id)
  const ok = [...entries(assets.rdv.name)].some((e) => e.startsWith(`files/${id}-`)) && [...entries(assets.logs.name)].some((e) => e.startsWith(`files/${id}-`))
  if (!ok) unresolved.push(`not inside ${assets.rdv.name}/${assets.logs.name}: ${id}`)
  inZip += ok
}
console.log(`${key}: ${sample - unresolved.filter((u) => !u.startsWith('not inside')).length} of ${sample} random sections resolve to rdv + logs + aux assets${local.length ? `; ${inZip} of ${local.length} checked inside the local zips` : '; release zips not on disk, membership not checked'}`)
if (unresolved.length) { console.error(unresolved.slice(0, 10).join('\n')); process.exit(1) }
