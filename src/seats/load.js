// The rows of the seat calculation, read from the database: votes per candidate, the party lists, the annulled candidates, the official
// elected list and the sections counted. Everything goes through `q` (use.js), so the panels show the SQL and open it in the console.
import { ELECTIONS, inElection } from '../model'
import { ensure, ensureSmall } from '../data'
import { objects } from '../db'
import { residualOn, rollup } from '../results'
import { t } from '../i18n'

const SCOPE = `($2::text = '' or uf = $2)`

// the same quotients in plain SQL (valid votes, quociente eleitoral, quociente partidário per bloc): the calculation checks itself with it
const checkSql = (key, legend) => `with l as (select party, bloc, valid, ${legend} legend from lineup where ${inElection(key)} and office = $1 and uf = $2),
  v as (select substr(r.cand, 1, 2) party, sum(r.votes) nominal from ${rollup(key).res} r where ${inElection(key, 'r')} and r.office = $1 and r.state = $2
    and not exists (select 1 from annulled a where ${inElection(key, 'a')} and a.office = r.office and a.uf = r.state and a.n = r.cand) group by 1),
  b as (select l.bloc, sum(case when l.valid then coalesce(v.nominal, 0) + l.legend else 0 end) votes from l left join v using (party) group by 1),
  s as (select sum(seats) seats from seats where ${inElection(key)} and office = $1 and uf = $2),
  t as (select sum(votes) valid, seats, floor(sum(votes) / seats) f from b, s group by seats),
  e as (select valid, seats, f + (case when 2 * (valid - f * seats) > seats then 1 else 0 end) qe from t)
  select b.bloc, b.votes, floor(b.votes / e.qe) qp, e.qe, e.valid, e.seats from b, e order by b.votes desc, b.bloc`

// sections with a published result against the sections of the UF (elections without coverage data: every section of the dump)
async function coverage(q, key, office, uf) {
  const e = inElection(key)
  const [sql, params] = ELECTIONS[key].hasCoverage
    ? [`select sum(own) own, sum(stored) stored, sum(aggregated) aggregated, sum(missing) missing from cov where ${e} and state <> 'zz' and ($1::text = '' or state = $1)`, [uf]]
    : [`select sum(sections) stored, 0 missing from tot where ${e} and office = $1 and ($2::text = '' or state = $2)`, [office, uf]]
  return objects(await q(sql, params))[0]
}

/** { inputs: Map(uf -> calculation input), official: Map(uf -> elected rows), names: Map("uf/n" -> { name, party }), coverage, check } for one UF, or every UF when `uf` is ''. */
export async function loadSeats(q, key, office, uf) {
  await Promise.all([ensure('cands'), ensureSmall(key, 'res', 'seats', 'lineup', 'annulled', 'elected', 'tot', 'cov', 'residual')])
  const { year, turn } = ELECTIONS[key]
  const legend = residualOn.value ? 'legend + residual' : 'legend'
  const e = inElection(key)
  const rows = async (sql) => Object.groupBy(objects(await q(sql, [office, uf])), (r) => r.uf)
  const [seats, lineup, votes, annulled, elected, names] = await Promise.all([
    rows(`select uf, sum(seats)::int seats from seats where ${e} and office = $1 and ${SCOPE} group by uf`),
    rows(`select uf, party, sigla, bloc, name, valid, ${legend} legend, official from lineup where ${e} and office = $1 and ${SCOPE} order by uf, party`),
    rows(`select state uf, cand n, sum(votes)::int votes from ${rollup(key).res} where ${e} and office = $1 and ($2::text = '' or state = $2) group by state, cand`),
    rows(`select uf, n from annulled where ${e} and office = $1 and ${SCOPE}`),
    rows(`select uf, n, name, party, status, votes from elected where ${e} and office = $1 and ${SCOPE} order by uf, votes desc`),
    rows(`select uf, n, short_name name, party from cands where election = ${year} and turn = ${turn} and office = $1 and ${SCOPE}`),
  ])
  if (!Object.keys(seats).length || !Object.keys(lineup).length) throw new Error(t('seats.noData'))
  const inputs = new Map(Object.entries(seats).map(([u, [s]]) => [u, {
    seats: s.seats, lineup: lineup[u] ?? [], votes: votes[u] ?? [], annulled: (annulled[u] ?? []).map((r) => r.n),
    officialVotes: (lineup[u] ?? []).reduce((n, p) => n + p.official, 0),
  }]))
  const check = uf ? objects(await q(checkSql(key, legend), [office, uf])) : null
  return {
    inputs, official: new Map(Object.entries(elected)), check, coverage: await coverage(q, key, office, uf),
    names: new Map(Object.values(names).flat().map((r) => [`${r.uf}/${r.n}`, r])),
  }
}
