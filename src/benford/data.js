// The only module of the Benford view that talks to the data layer: it loads the lazy parts of benford_hist / benford_base /
// benford_stat and builds every query. The tables follow the unified style (election, turn, office, unit, uf, city, cand, pos),
// so a change of the dump's schema is a change of this file only.
import { ensure, parts } from '../data'
import { objects } from '../db'
import { ELECTIONS } from '../elections.js'
import { inElection } from '../model'
import { analyze } from './analysis'
import { DIGITS } from './stats'
import { t } from '../i18n'
import { GROUP, PSEUDO } from './keys'

const TABLES = ['benford_hist', 'benford_base', 'benford_stat']

export const isParty = (cand) => /^p\d\d$/.test(cand)
export const isPseudo = (cand) => cand in PSEUDO

// Part ids are `<election key>/br` (national places, the UF places of the first, second and last digit) and `<election key>/<uf>`
// (that UF's municipalities, city unit, first two digits); an election without data simply has none.
const idsOf = (table, key, places) => places.map((place) => `${key}/${place}`).filter((id) => parts(table, key).includes(id))

/** Loads the national part and, for a UF place, that UF's part of every table. */
export const ensureScope = (key, uf) => Promise.all([ensure('cands'), ...TABLES.map((table) => ensure(table, idsOf(table, key, uf === 'br' ? ['br'] : ['br', uf])))])

/** Every part of the election (the municipality map of the whole country). */
export const ensureAll = (key) => Promise.all([ensure('mun_map'), ...TABLES.map((table) => ensure(table, parts(table, key)))])

export const buildParams = (manifest) => manifest.tables.benford_hist.params

// ---- queries: every one returns [sql, params] for the `q` of useAsync; the election and turn are inlined (inElection) -------------

const JOIN = `b.election = h.election and b.turn = h.turn and b.office = h.office and b.unit = h.unit and b.uf = h.uf and b.city is not distinct from h.city and b.cand = h.cand and b.pos = h.pos and b.digit = h.digit`
const WHERE = (p) => `${inElection(p.election, 'h')} and h.office = $1 and h.unit = $2 and h.uf = $3 and h.city is not distinct from $4::text`
const place = (p) => [p.office, p.unit, p.uf, p.city]

/** Digit counts of one scope with the baseline envelope of each digit. */
export const digitsQuery = (p) => [`select h.digit, h.n, b.mean, b.lo, b.hi from benford_hist h left join benford_base b on ${JOIN}
  where ${WHERE(p)} and h.cand = $5 and h.pos = $6 order by h.digit`, [...place(p), p.cand, p.pos]]

/** Baseline distribution of the MAD and of the chi-square of one scope. */
export const statQuery = (p) => [`select stat, mean, lo, hi from benford_stat h where ${WHERE(p)} and cand = $5 and pos = $6`, [...place(p), p.cand, p.pos]]

/** Candidates and totals that have a first-digit histogram at the place, with their N. */
export const candsQuery = (p) => [`select cand, sum(n) n from benford_hist h where ${WHERE(p)} and pos = 'd1' group by cand order by n desc`, place(p)]

/** Municipalities of a UF with a histogram of the candidate. */
export const citiesQuery = (p) => [`select distinct city from benford_hist h where ${inElection(p.election, 'h')} and office = $1 and unit = 'section' and uf = $2 and city is not null and cand = $3 order by 1`, [p.office, p.uf, p.cand]]

/** Every candidate of the place for one position (small multiples): counts with envelope, and the MAD baseline. */
export const multiplesQueries = (p) => [
  [`select h.cand, h.digit, h.n, b.mean, b.lo, b.hi from benford_hist h left join benford_base b on ${JOIN} where ${WHERE(p)} and h.pos = $5 order by h.cand, h.digit`, [...place(p), p.pos]],
  [`select cand, mean, lo, hi from benford_stat h where ${WHERE(p)} and pos = $5 and stat = 'mad'`, [...place(p), p.pos]],
]

/** One candidate in every UF (section unit): counts with the envelope of each digit, and the MAD baseline of each UF. */
export const heatQueries = (p) => {
  const where = `${inElection(p.election, 'h')} and h.office = $1 and h.unit = 'section' and h.city is null and h.uf <> 'br' and h.cand = $2 and h.pos = $3`
  const args = [p.office, p.cand, p.pos]
  return [
    [`select h.uf, h.digit, h.n, b.mean, b.lo, b.hi from benford_hist h left join benford_base b on ${JOIN} where ${where} order by h.uf, h.digit`, args],
    [`select h.uf, mean, lo, hi from benford_stat h where ${where} and stat = 'mad'`, args],
  ]
}

/** Counts per place (UFs, or the municipalities of `p.uf` / of every UF) and the baseline MAD of each, for map and ranking. */
export const placesQueries = (p, grain) => {
  const mun = grain === 'mun'
  const [cand, pos] = mun ? ['$3', '$4'] : ['$2', '$3']
  const level = mun ? `h.city is not null and ($2 = 'br' or h.uf = $2)` : `h.city is null and h.uf <> 'br'`
  const args = [p.office, ...(mun ? [p.uf] : []), p.cand, p.pos]
  const where = `${inElection(p.election, 'h')} and h.office = $1 and h.unit = 'section' and ${level} and h.cand = ${cand} and h.pos = ${pos}`
  return [
    [`select h.uf, h.city, array_agg(h.n order by h.digit) counts from benford_hist h where ${where} group by 1, 2`, args],
    [`select h.uf, h.city, mean, lo, hi from benford_stat h where ${where} and stat = 'mad'`, args],
  ]
}

export const munMapQuery = () => [`select state, city, ibge from mun_map`, []]

export const labelsQuery = (p) => [`select uf, n, short_name, party from cands where election = ${ELECTIONS[p.election].year} and office = $1 and ($2 = 'br' or $2 = uf or $1 = 1)`, [p.office, p.uf]]

// ---- shaping rows -------------------------------------------------------------------------------------------------------------

/** { counts, base } of one scope from digitsQuery rows (base is null when the scope has no baseline). */
export function scopeOf(pos, rows) {
  const first = DIGITS[pos][0]
  const [counts, base] = [Array(DIGITS[pos].length).fill(0), Array(DIGITS[pos].length).fill(null)]
  for (const r of rows) { counts[r.digit - first] = r.n; if (r.mean != null) base[r.digit - first] = { mean: r.mean, lo: r.lo, hi: r.hi } }
  return { counts, base: base.every(Boolean) ? base : null }
}

export const statOf = (rows) => (rows.length ? Object.fromEntries(rows.map((r) => [r.stat, { mean: r.mean, lo: r.lo, hi: r.hi }])) : null)

const titleCase = (s) => s.toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase())

/** Maps of the candidate names: persons by `uf|number` (president: br), party names by the two-digit prefix. */
export function labelsOf(rows) {
  const [persons, parties] = [new Map(), new Map()]
  for (const r of objects(rows)) {
    persons.set(`${r.uf}|${r.n}`, r.short_name ?? r.n)
    if (r.n.length > 2) parties.set(r.n.slice(0, 2), r.party)
  }
  return { persons, parties }
}

export function candLabel(cand, { office, uf }, labels) {
  if (isPseudo(cand)) return t(PSEUDO[cand])
  if (isParty(cand)) { const party = labels.parties.get(cand.slice(1)); return party ? t('benford.cand.party', { party, n: cand.slice(1) }) : t('benford.cand.partyNumber', { n: cand.slice(1) }) }
  const name = labels.persons.get(`${office === 1 ? 'br' : uf}|${cand}`)
  return name ? t('benford.cand.person', { name: titleCase(name), n: cand }) : cand
}

export const candGroup = (cand) => (isPseudo(cand) ? 'totals' : isParty(cand) ? 'parties' : 'candidates')
export const GROUPS = Object.keys(GROUP)

// ---- SQL that reproduces a scope from the section views ---------------------------------------------------------------------

const DIGIT_SQL = { d1: `left(v::text, 1)::int`, d2: `substr(v::text, 2, 1)::int`, d12: `left(v::text, 2)::int`, d_last: `v % 10` }
const TOTAL_COLUMN = { nominal: 'nominal', branco: 'blank', nulo: 'nul' }
const KEYS = { section: 'state, city, zone, section', city: 'state, city', uf: 'state' } // i18n-ignore: SQL
const quote = (s) => `'${s.replaceAll("'", "''")}'`

/** The votes of every unit of the scope (section, city or UF) as the shared section views sec / cs hold them. */
function valuesSql(p) {
  const [source, votes] = isPseudo(p.cand)
    ? [`sec where ${inElection(p.election)} and office = ${p.office}`, TOTAL_COLUMN[p.cand]]
    : [`cs where ${inElection(p.election)} and office = ${p.office} and ${isParty(p.cand) ? `left(cand, 2) = '${p.cand.slice(1)}'` : `cand = '${p.cand}'`}`, 'votes']
  const filter = [p.uf !== 'br' && `state = '${p.uf}'`, p.city && `city = ${quote(p.city)}`, p.unit !== 'section' && `state <> 'zz'`].filter(Boolean)
  return `select sum(${votes}) v from ${source}${filter.map((f) => ` and ${f}`).join('')} group by ${KEYS[p.unit]}`
}

/** A query over the sections that gives the same digit counts as the shipped table (zeros, and one-digit counts for d2/d12, have no digit). */
export const rawSql = (p) => `select ${DIGIT_SQL[p.pos]} digit, count(*) n from (${valuesSql(p)}) t
where v > 0${p.pos === 'd1' || p.pos === 'd_last' ? '' : ' and v >= 10'} group by 1 order by 1`

const cityFilter = (city) => (city ? `= ${quote(city)}` : 'is null') // i18n-ignore: SQL

/** The same numbers (and the baseline envelope) from the shipped tables. */
export const shippedSql = (p) => `select h.digit, h.n, b.mean, b.lo, b.hi from benford_hist h left join benford_base b on ${JOIN}
where ${inElection(p.election, 'h')} and h.office = ${p.office} and h.unit = '${p.unit}' and h.uf = '${p.uf}' and h.city ${cityFilter(p.city)}
and h.cand = '${p.cand}' and h.pos = '${p.pos}' order by h.digit`

/** Places for the map and the ranking: { id (UF or IBGE code), uf, city, result } with the verdict taken from the MAD baseline. */
export function placesOf(pos, [counts, stats], ibge, minN) {
  const band = new Map(objects(stats).map((r) => [`${r.uf}|${r.city}`, { mad: { mean: r.mean, lo: r.lo, hi: r.hi } }]))
  return objects(counts).map((r) => ({
    id: r.city ? ibge.get(`${r.uf}|${r.city}`) : r.uf, uf: r.uf, city: r.city,
    result: analyze(pos, JSON.parse(r.counts), null, band.get(`${r.uf}|${r.city}`) ?? null, minN),
  }))
}
