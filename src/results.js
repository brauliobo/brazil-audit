// Shared result queries for the map, polarization and overview panels (all read the small tot/res rollups).
import { computed } from 'vue'
import { ensure, ensureSmall } from './data'
import { route } from './router'
import { objects } from './db'
import { partyColor } from './colors'
import { int, pct } from './format'
import { ELECTIONS, STATE_NAMES, candJoin, inElection } from './model'

/**
 * Elections with residual votes: add the official totals of sections without published files (table residual) to every rollup
 * (national, UF and city level; never to zones, sections or any section-based analysis). `?residual=0` turns it off.
 */
export const residualOn = computed(() => ELECTIONS[route.value.election].hasResidual && route.value.params.get('residual') !== '0')

/** Names of the result and total rollups to query for an election (with or without the residual). */
export const rollup = (key) => (ELECTIONS[key].hasResidual && residualOn.value ? { res: 'resx', tot: 'totx' } : { res: 'res', tot: 'tot' })

/** Loads everything the rollup-based visualizations need for an election. */
export async function ensureRollups(key) {
  await Promise.all([ensure('cands'), ensure('mun_map')])
  await ensureSmall(key, 'res', 'tot', 'residual')
}

/** Leading two candidates per state for the president, with the state's valid (nominal) votes. */
export async function stateWinners(q, year) {
  return objects(await q(`with v as (select r.state, r.cand, 1 office, sum(r.votes) votes from ${rollup(year).res} r where r.office = 1 and ${inElection(year, 'r')} group by 1, 2),
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
  return `with v as (select ${id} id, max(${name}) name, r.state, r.office, r.cand, sum(r.votes) votes from ${rollup(y).res} r ${join} where r.office = $1 and ${inElection(y, 'r')} and ${where} group by ${id}, r.state, r.office, r.cand),
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

export const unitPlace = (u, grain) => (grain === 'uf' ? `${u.id.toUpperCase()} · ${STATE_NAMES[u.id]}` : `${titleCase(u.name)} (${u.state.toUpperCase()})`)

/** Tooltip text of a unit: place, its top candidates and the winner (+ optional extra lines). */
export const unitTip = (u, grain, extra = []) => [
  unitPlace(u, grain),
  ...u.list.filter((r) => r.rn <= 3).map((r) => `${candName(r)}: ${int(r.votes)} (${pct(r.votes / u.valid, 1)})`),
  `Vencedor: ${candName(top(u, 1))}`, ...extra,
].join('\n')

/** Winner colour per unit, stronger with the margin of victory (saturating at the 90th percentile). */
export function winnerFills(units) {
  const hi = quantile([...units.values()].map(margin), 0.9) || 1
  return Object.fromEntries([...units].map(([id, u]) => [id, [partyColor(top(u, 1).party), 0.4 + 0.6 * Math.min(margin(u) / hi, 1)]]))
}

/** The parties (or candidates for the president) that win most units, for the legend. */
export function winnerLegend(units, office, size = 8) {
  const tally = Object.groupBy([...units.values()], (u) => top(u, 1).party ?? '–')
  return Object.entries(tally).map(([party, l]) => ({ party, n: l.length, label: office === 1 ? candName(top(l[0], 1)) : party })).sort((a, b) => b.n - a.n).slice(0, size)
}
