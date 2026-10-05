// Independent recomputation of the observed histograms from the loaded facts (plain JS over the same snapshot, no SQL): the
// build stops when a single count differs from what the SQL produced.
import { histogram } from '../../src/benford/stats.js'

const push = (map, k, v) => (map.has(k) ? map.get(k).push(v) : map.set(k, [v]))

/** The value lists of one series by unit and place key `uf\tcity` (national: `br\t`); city and uf units skip the consular posts. */
function places(data, { ids, votes }) {
  const [section, city, uf] = [new Map(), new Map(), new Map()]
  const [byMun, byUf] = [new Map(), new Map()]
  ids.forEach((id, i) => {
    const m = data.muns[data.munOf[id]]
    for (const k of [`${m.uf}\t`, 'br\t', `${m.uf}\t${m.city}`]) push(section, k, votes[i])
    byMun.set(`${m.uf}\t${m.city}`, (byMun.get(`${m.uf}\t${m.city}`) ?? 0) + votes[i])
  })
  for (const [k, v] of byMun) {
    const ufName = k.split('\t')[0]
    if (ufName === 'zz') continue
    push(city, `${ufName}\t`, v)
    push(city, 'br\t', v)
    byUf.set(ufName, (byUf.get(ufName) ?? 0) + v)
  }
  for (const v of byUf.values()) push(uf, 'br\t', v)
  return { section, city, uf }
}

/** Throws on the first scope whose SQL histogram differs; returns how many scopes were compared. */
export function check(data, facts, observed) {
  for (const [cand, scopes] of Map.groupBy(observed, (s) => s.cand)) {
    const all = places(data, facts.get(cand))
    for (const s of scopes) {
      const mine = histogram(s.pos, all[s.unit].get(`${s.uf}\t${s.city ?? ''}`) ?? [])
      if (mine.some((n, i) => n !== s.counts[i])) throw new Error(`SQL and JS histograms differ for ${[s.unit, s.uf, s.city, s.cand, s.pos]}: ${s.counts} vs ${mine}`)
    }
  }
  return observed.length
}
