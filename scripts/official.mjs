// Official TSE result files (city and zone level) and what the shipped rdv parts hold, shared by the residual step and the
// verification script.
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { parseCsvLine } from './csv.mjs'
import { cached } from './geo.mjs'

export const OFFICIAL = { 1: ['6257', 'c0001'], 3: ['6259', 'c0003'], 5: ['6259', 'c0005'], 6: ['6259', 'c0006'], 7: ['6259', 'c0007'], 8: ['6259', 'c0008'] }
export const officesOf = (uf) => (uf === 'zz' ? [1] : uf === 'df' ? [1, 3, 5, 6, 8] : [1, 3, 5, 6, 7])
export const EMPTY = { cands: new Map(), blank: 0, nul: 0 }

/** The official result file of a municipality (zone null) or of one zone of it; cached 12 h, throttled by cached(). */
export async function officialFile(uf, cityCode, zone, office) {
  const [event, cargo] = OFFICIAL[office]
  const name = `${uf}${cityCode}${zone ? `-z${zone}` : ''}-${cargo}-e00${event}-u.json`
  return JSON.parse(await cached(`official-${name}`, `https://resultados.tse.jus.br/oficial/ele2026/${event}/dados/${uf}/${name}`, { maxAgeHours: 12 }))
}

/** What the given rdv part files hold for the cities: { zones: Map "city|zone|office", cities: Map "city|office" } of { cands, blank, nul }. */
export function dumpOf(files, cities) {
  const [zones, byCity] = [new Map(), new Map()]
  const take = (map, key, f) => {
    const entry = map.get(key) ?? { cands: new Map(), blank: 0, nul: 0 }
    map.set(key, entry)
    entry.blank += +f[7]
    entry.nul += +f[8]
    for (const [n, v] of Object.entries(JSON.parse(f[9]))) entry.cands.set(n, (entry.cands.get(n) ?? 0) + v)
  }
  for (const file of files) {
    for (const line of gunzipSync(readFileSync(file)).toString().split('\n')) {
      const city = /^[^,]*,("(?:[^"]|"")*"|[^,]*),/.exec(line)?.[1].replace(/^"|"$/g, '').replaceAll('""', '"')
      if (!cities.has(city)) continue
      const f = parseCsvLine(line)
      take(zones, `${city}|${f[2]}|${f[5]}`, f)
      take(byCity, `${city}|${f[5]}`, f)
    }
  }
  return { zones, cities: byCity }
}

/** Official minus dump: { rows: [[number, votes]] } or { skip, detail } (not totalized, or a stale file giving a negative residual). */
export function residualOf(official, dump) {
  const { s, v, carg } = official
  if (+s.st < +s.ts) return { skip: 'not_totalized', detail: `${s.st} of ${s.ts} sections` }
  const votes = new Map(carg[0].agr.flatMap((a) => a.par.flatMap((p) => (p.cand ?? []).map((c) => [c.n, +c.vap]))))
  const unknown = [...dump.cands].filter(([n]) => !votes.has(n)).reduce((t, [, x]) => t + x, 0) // numbers the TSE lists as invalid
  const rows = [...votes].map(([n, x]) => [n, x - (dump.cands.get(n) ?? 0)])
  rows.push(['branco', +v.vb - dump.blank], ['nulo', +v.tvn - dump.nul - unknown])
  const negative = rows.find(([, x]) => x < 0)
  return negative ? { skip: 'negative', detail: `${negative[0]}: ${negative[1]}` } : { rows: rows.filter(([, x]) => x > 0) }
}
