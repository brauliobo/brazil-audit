// Shared result queries for the map, tile-grid and polarization panels (all read the small tot_/res_ rollups).
import { ensure, ensureDefault } from './data'
import { objects } from './db'
import { candJoin } from './model'

/** Loads everything the rollup-based visualizations need for an election. */
export async function ensureRollups(year) {
  await Promise.all([ensure('cands'), ensure('mun_map')])
  await (year === '2022' ? ensureDefault('votes_2022') : Promise.all([ensure('res_2026'), ensure('tot_2026')]))
}

/** Leading two candidates per state for the president, with the state's valid (nominal) votes. */
export async function stateWinners(q, year) {
  return objects(await q(`with v as (select r.state, r.cand, 1 office, sum(r.votes) votes from res_${year} r where r.office = 1 group by 1, 2),
    rk as (select *, row_number() over (partition by state order by votes desc, cand) rn, sum(votes) over (partition by state) valid from v)
    select rk.state, rk.cand, rk.votes, rk.valid, rk.rn, c.short_name name, c.party from rk ${candJoin(year, 'rk')} where rn <= 2 order by state, rn`))
}

export const titleCase = (s) => s.toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase())

/** "Flavio Bolsonaro vence em 14 estados e no DF; Lula da Silva em 12": first-round winner per state by nominal votes. */
export function winnersHeadline(rows) {
  const first = rows.filter((r) => r.rn === 1 && r.state !== 'zz')
  const tally = Object.entries(Object.groupBy(first, (r) => r.name ?? r.cand)).map(([name, l]) => ({ name, states: l.filter((r) => r.state !== 'df').length, df: l.some((r) => r.state === 'df') }))
  tally.sort((a, b) => b.states + b.df - (a.states + a.df))
  const count = (t) => (t === tally[0] ? `vence em ${t.states} ${t.states === 1 ? 'estado' : 'estados'}` : `em ${t.states}`)
  const part = (t) => `${titleCase(t.name)} ${count(t)}${t.df ? ' e no DF' : ''}`
  return tally.length ? tally.map(part).join('; ') : ''
}

// ---- units (states or municipalities) with their leading candidates, shared by the maps and the state mini-map ----------

/** One row per (unit, candidate) for the top 3 candidates and the selected `cand`; grain 'uf' ($1 office, $2 cand) or 'mun' ($1 office, $2 uf or '', $3 cand). */
export function unitSql(y, grain) {
  const [id, name, join, where] = grain === 'uf'
    ? ['r.state', 'r.state', '', `r.state <> 'zz'`]
    : ['m.ibge', 'r.city', 'join mun_map m on m.state = r.state and m.city = r.city', `m.ibge is not null and ($2::text = '' or r.state = $2)`]
  return `with v as (select ${id} id, max(${name}) name, r.state, r.office, r.cand, sum(r.votes) votes from res_${y} r ${join} where r.office = $1 and ${where} group by ${id}, r.state, r.office, r.cand),
    rk as (select *, row_number() over (partition by id order by votes desc, cand) rn, sum(votes) over (partition by id) valid from v)
    select rk.id, rk.name, rk.state, rk.cand, rk.votes, rk.rn, rk.valid, c.short_name cname, c.party from rk ${candJoin(y, 'rk')} where rk.rn <= 3 or rk.cand = $${grain === 'uf' ? 2 : 3}`
}

export function unitsOf(result) {
  const units = new Map()
  for (const r of objects(result)) {
    const u = units.get(r.id) ?? { id: r.id, name: r.name, state: r.state, valid: r.valid, list: [] }
    units.set(r.id, u)
    u.list.push(r)
  }
  return units
}

export const candName = (r) => (r.cname ? titleCase(r.cname) : 'Outros / inválidos')
export const top = (u, n) => u.list.find((r) => r.rn === n)
export const margin = (u) => (u.list.length > 1 ? (top(u, 1).votes - (top(u, 2)?.votes ?? 0)) / u.valid : 1)
export const quantile = (values, p) => values.toSorted((a, b) => a - b)[Math.floor((values.length - 1) * p)] ?? 1
