// Runs the simulation for every series of an election/office and keeps the scopes that have an observed histogram.
import { dense } from './load.mjs'
import { PARAMS, munSections } from './plan.mjs'
import { hash } from './rng.mjs'
import { simulate } from './simulate.mjs'

const key = (s) => [s.unit, s.uf, s.city, s.cand, s.pos].join('\t')

/** A series with a national row is one task over every UF; the others (a governor candidate, a local party) one task per UF. */
function tasks(series, office) {
  const allUfs = [...new Set(office.muns.map((m) => m.uf))]
  return [...Map.groupBy(series, (s) => s.cand)].flatMap(([cand, rows]) => {
    const national = rows.find((r) => r.uf === 'br')
    return national ? [{ cand, ufs: allUfs, national: true, mun: national.mun }] : rows.map((r) => ({ cand, ufs: [r.uf], national: false, mun: r.mun }))
  })
}

/** Municipalities (indexes) a task keeps places for: enough sections, in its UFs, not the consular posts. */
const wantedMuns = (data, office, t) => new Set(t.mun ? data.muns.flatMap((m, i) => (m.end - m.start >= munSections(office) && m.uf !== 'zz' && t.ufs.includes(m.uf) ? [i] : [])) : [])

/** Baseline scopes { unit, uf, city, cand, pos, digits, mad, chi2 } matching the observed ones (`observed`). */
export async function baseline(el, office, data, facts, series, observed, log) {
  const wanted = new Set(observed.map(key))
  const out = []
  const list = tasks(series, data)
  let done = 0
  for (const t of list) {
    const seed = hash([PARAMS.seed, el.year, el.turn, office, t.cand, t.ufs.length === 1 ? t.ufs[0] : 'br'].join('|'))
    const levels = { ufs: t.ufs, national: t.national, muns: wantedMuns(data, office, t) }
    for (const s of simulate(data, dense(data, facts.get(t.cand)), levels, { reps: PARAMS.reps, seed })) {
      const scope = { ...s, city: s.city == null ? null : data.muns[s.city].city, cand: t.cand }
      if (wanted.has(key(scope))) out.push(scope)
    }
    if (++done % 25 === 0 || done === list.length) log(`  baseline ${el.year}/${el.turn}/${office}: ${done}/${list.length} series`)
  }
  return out
}

export { key as scopeKey }
