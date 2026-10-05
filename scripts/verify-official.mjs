// Compares the shipped 2026 data (res_2026 + residual_2026) with the official UF and national result files of the TSE.
//   node scripts/verify-official.mjs            prints the match table and every mismatch
import { existsSync, readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { parseCsvLine } from './csv.mjs'
import { cached, tseMunicipalities } from './geo.mjs'
import { OFFICIAL, dumpOf, officesOf, officialFile } from './official.mjs'

const rows = (name) => gunzipSync(readFileSync(`data/${name}/2026.csv.gz`)).toString().trim().split('\n').map(parseCsvLine)
const UFS = [...new Set(rows('tot').map((r) => r[2]))].sort()

// ours[uf][office] = Map(number -> votes, plus 'branco', 'nulo+invalidos')
const ours = {}
const add = (uf, office, key, v) => { const m = ((ours[uf] ??= {})[office] ??= new Map()); m.set(key, (m.get(key) ?? 0) + +v) }
for (const [, , uf, , office, cand, votes] of rows('res')) add(uf, office, cand, votes)
for (const [, , uf, , , , office, number, votes] of rows('residual')) {
  add(uf, office, number, votes)
  if (number !== 'branco' && number !== 'nulo') add(uf, office, 'nominal', votes)
}
for (const [, , uf, , office, , nominal, blank, nul] of rows('tot')) { add(uf, office, 'branco', blank); add(uf, office, 'nulo', nul); add(uf, office, 'nominal', nominal) }

const official = async (uf, office) => {
  const [event, cargo] = OFFICIAL[office]
  const j = JSON.parse(await cached(`verify-${uf}-${cargo}.json`, `https://resultados.tse.jus.br/oficial/ele2026/${event}/dados/${uf}/${uf}-${cargo}-e00${event}-u.json`, { fresh: true }))
  return { j, cands: new Map(j.carg[0].agr.flatMap((a) => a.par.flatMap((p) => (p.cand ?? []).map((c) => [c.n, +c.vap])))) }
}

const mismatches = []
const nullDiffs = []
let pairs = 0, matched = 0
for (const uf of [...UFS, 'br']) {
  for (const office of uf === 'br' ? [1] : officesOf(uf)) {
    let o
    try { o = await official(uf, office) } catch (e) { mismatches.push([uf, office, 'official file', e.message.slice(-30), '']); pairs++; continue }
    const mine = uf === 'br' ? new Map(UFS.flatMap((u) => [...(ours[u]?.[office] ?? [])]).reduce((m, [k, v]) => m.set(k, (m.get(k) ?? 0) + v), new Map())) : ours[uf][office]
    const unknown = (mine.get('nominal') ?? 0) - [...o.cands.keys()].reduce((t, n) => t + (mine.get(n) ?? 0), 0)
    const checks = [...o.cands].map(([n, v]) => [n, mine.get(n) ?? 0, v])
    checks.push(['branco', mine.get('branco') ?? 0, +o.j.v.vb])
    const bad = checks.filter(([, a, b]) => a !== b)
    pairs++
    if (bad.length) mismatches.push(...bad.slice(0, 3).map(([n, a, b]) => [uf, office, n, a, b, `${bad.length} items differ; official totalized ${o.j.s.st}/${o.j.s.ts} sections`]))
    else matched++
    // null ballots are reported apart: the official null total (tvn) = nulls (vn) + technical nulls (vnt) that the RDV does not carry
    const nulls = [(mine.get('nulo') ?? 0) + unknown, +o.j.v.tvn]
    if (nulls[0] !== nulls[1]) nullDiffs.push(`${uf}/${office}: ${nulls[1] - nulls[0]} (official technical nulls vnt ${o.j.v.vnt}, invalid numbers in our nominal votes ${unknown})`)
  }
}
console.log(`UF/office pairs with every candidate and the blank votes equal to the official files: ${matched} of ${pairs}`)
for (const m of mismatches) console.log(m.join(' | '))
console.log(`null ballots differing from the official total (not a residual issue): ${nullDiffs.length} pairs: ${nullDiffs.join(', ')}`)

// zone level: for every zone with a zone-level residual, dump + residual per candidate and blank must equal the official zone file
const mun = await tseMunicipalities()
const codes = new Map(mun.abr.flatMap((a) => a.mu.map((m) => [`${a.cd}/${m.nm}`, m.cd])))
const residualRows = rows('residual').filter((r) => r[5]).map((r) => r.slice(2))
const zones = [...new Set(residualRows.map((r) => `${r[0]}|${r[1]}|${r[3]}`))]
let zoneOk = 0, zoneChecks = 0
const zoneBad = []
for (const uf of [...new Set(zones.map((z) => z.split('|')[0]))]) {
  const parts = ['', '.6', '.7', '.8'].map((x) => `data/rdv/2026-${uf}${x}.csv.gz`).filter((f) => existsSync(f))
  const dump = dumpOf(parts, new Set(zones.filter((z) => z.startsWith(`${uf}|`)).map((z) => z.split('|')[1])))
  for (const key of zones.filter((z) => z.startsWith(`${uf}|`))) {
    const [, city, zone] = key.split('|')
    for (const office of new Set(residualRows.filter((r) => r[0] === uf && r[1] === city && r[3] === zone).map((r) => +r[4]))) {
      const j = await officialFile(uf, codes.get(`${uf}/${city}`), zone, office)
      const mine = new Map(dump.zones.get(`${city}|${zone}|${office}`)?.cands ?? [])
      for (const r of residualRows) if (r[0] === uf && r[1] === city && r[3] === zone && +r[4] === office && r[5] !== 'branco' && r[5] !== 'nulo') mine.set(r[5], (mine.get(r[5]) ?? 0) + +r[6])
      const blank = (dump.zones.get(`${city}|${zone}|${office}`)?.blank ?? 0) + residualRows.filter((r) => r[0] === uf && r[1] === city && r[3] === zone && +r[4] === office && r[5] === 'branco').reduce((t, r) => t + +r[6], 0)
      const checks = [...j.carg[0].agr.flatMap((a) => a.par.flatMap((p) => (p.cand ?? []).map((c) => [c.n, mine.get(c.n) ?? 0, +c.vap])))]
      checks.push(['branco', blank, +j.v.vb])
      const bad = checks.filter(([, a, b]) => a !== b)
      zoneChecks++
      if (bad.length) zoneBad.push(`${uf}/${city}/${zone}/${office}: ${bad.slice(0, 2).map((b) => b.join(' ')).join('; ')}`)
      else zoneOk++
    }
  }
}
console.log(`zone/office pairs with a zone-level residual that equal the official zone files (candidates and blank): ${zoneOk} of ${zoneChecks}`)
for (const b of zoneBad) console.log(b)
