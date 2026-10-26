import { cachedFetch, gunzip } from './db/fetching'
import sectionIndex from '../data/comparison-stats/index.json'
import { objects } from './db'
import * as benford from './benford/data'
import { analyze } from './benford/analysis'

const sectionLoads = new Map()
export async function sectionComparison(id, election, state, city) {
  const part = sectionIndex.elections.find((p) => p.key === election.key)
  if (!part) return null
  if (!sectionLoads.has(part.key)) sectionLoads.set(part.key, (async () => {
    const response = await cachedFetch(`${import.meta.env.BASE_URL}data/${part.path}`, part.sha256)
    return new Response(gunzip(response)).json()
  })())
  const data = await sectionLoads.get(part.key)
  const row = data.rows.find((r) => r.scope === (city ? 'city' : state ? 'uf' : 'br') && r.state === state && r.city === city)
  return row ? { value: row[id], numerator: row[id], denominator: row.sections, records: row.sections, source: 'section_stats' } : null
}


export async function benfordComparison(id, election, state, city, office, target, position, unit, q) {
  if (state) await benford.ensureScope(election.key,state)
  else await benford.ensureAll(election.key)
  const p = { election:election.key,office,unit,uf:state || 'br',city:city || null,cand:target || 'nominal',pos:position }
  const digitRows = objects(await q(...benford.digitsQuery(p)))
  let stats = objects(await q(...benford.statQuery(p)))
  let scope = benford.scopeOf(position,digitRows)
  // National histograms can be reconstructed exactly by adding disjoint state scopes; simulation envelopes cannot.
  if (!state && !digitRows.length) {
    const pooled = objects(await q(`select digit,sum(n)::int n,null::float8 mean,null::float8 lo,null::float8 hi from benford_hist
      where election = ${election.year} and turn = ${election.turn} and office = $1 and unit = $2 and uf <> 'br' and city is null and cand = $3 and pos = $4 group by digit order by digit`,[office,unit,p.cand,position]))
    scope = benford.scopeOf(position,pooled)
    stats = []
  }
  const result = analyze(position,scope.counts,scope.base,benford.statOf(stats))
  if (!result.n) return null
  const value = id === 'benford_mad' ? result.mad : id === 'benford_chi2' ? result.chi2 : id === 'benford_p' ? result.p : result.index
  const band = result.baseline?.mad
  return { value:value ?? null,numerator:value ?? null,denominator:result.n,records:result.n,source:'benford',baseline:band ? `${band.mean} [${band.lo}; ${band.hi}]` : null,target:p.cand }
}
