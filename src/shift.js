// The shift between the two rounds of a presidential election, from round 1 to round 2, for the two finalists (a = the runoff winner, b = the other):
//   Δa + Δb = others₁ − Δnull − Δblank − Δabstention + Δelectorate
// because every round splits the electorate into votes for a candidate, blank, null and abstention. Nothing here says where a voter came from:
// the ballot is secret, so the identity only bounds how many new votes the finalists received and from which pool.
// Children of a place come from the municipality rollups (res, tot, sgz) down to the city and from the sections (rdv, sg) below it.
import { ELECTIONS, ELECTION_LIST, supportsView } from './model.js'
import { sideOf } from './spectrum.js'
import { estimate } from './estimate.js'

export const firstRoundOf = (key) => ELECTION_LIST.find((e) => e.year === ELECTIONS[key].year && e.turn === 1 && e.offices.includes(1))?.key
export const hasShift = (key) => supportsView(key, 'shift')

export const LEVELS = ['country', 'state', 'city', 'zone']
export const levelOf = (args) => LEVELS[Math.min(args.length, 3)]

const COLUMNS = ['a', 'b', 'nom', 'bl', 'nu', 'ap', 'co']
const pivot = (columns) => columns.map((c) => `coalesce(sum(${c}) filter (where turn = 1), 0)::bigint ${c}1, coalesce(sum(${c}) filter (where turn = 2), 0)::bigint ${c}2`).join(', ')
const PIVOT = pivot(COLUMNS)
const NUMBER = (n) => `coalesce((votes->>(${n}::text))::int, 0)`

// $1 year, $2 and $3 the finalists, $4 state (null = Brazil), $5 city, $6 zone. `c` = one row per round and municipality.
const CITIES = `with v as (select turn, state, city, sum(votes) filter (where cand = $2) a, sum(votes) filter (where cand = $3) b from resx
    where election = $1 and office = 1 and ($4::text is null or state = $4) group by turn, state, city),
  t as (select turn, state, city, sum(nominal) nom, sum(blank) bl, sum(nul) nu from totx
    where election = $1 and office = 1 and ($4::text is null or state = $4) group by turn, state, city),
  z as (select turn, state, city, sum(aptos) ap, sum(comp) co from sgz where election = $1 and ($4::text is null or state = $4) group by turn, state, city),
  c as (select * from t full join v using (turn, state, city) full join z using (turn, state, city))`

// $4 state, $5 city, $6 zone (only for the sections): one row per round and zone, or per round and section.
const SECTIONS = (key, filter) => `with r as (select turn, ${key}, sum(${NUMBER('$2')}) a, sum(${NUMBER('$3')}) b, sum(nominal) nom, sum(blank) bl, sum(nul) nu from rdv
    where election = $1 and office = 1 and state = $4 and city = $5 ${filter} group by turn, ${key}),
  g as (select turn, ${key}, sum(aptos) ap, sum(comp) co from sg where election = $1 and state = $4 and city = $5 ${filter} group by turn, ${key}),
  c as (select * from r full join g using (turn, ${key}))`

/** The children of the place in `args` ([], [uf], [uf, city], [uf, city, zone]): one row per child with both rounds, and its params. */
export function childrenSql(args, year, a, b) {
  const [state, city, zone] = args
  if (!state) return { sql: `${CITIES} select state k, ${PIVOT} from c group by state`, params: [year, a, b, null] }
  if (!city) return { sql: `${CITIES} select city k, ${PIVOT} from c group by city`, params: [year, a, b, state] }
  if (!zone) return { sql: `${SECTIONS('zone', '')} select zone k, ${PIVOT} from c group by zone`, params: [year, a, b, state, city] }
  return { sql: `${SECTIONS('section', 'and zone = $6')} select section k, ${PIVOT} from c group by section`, params: [year, a, b, state, city, zone] }
}

/** Every zone or section of a state with both rounds (the places where a finalist gained very few votes): city, zone[, section] as keys; votes only. */
export function unitsSql(grain, year, a, b, state) {
  const key = grain === 'section' ? 'city, zone, section' : 'city, zone' // i18n-ignore
  return {
    sql: `with r as (select turn, ${key}, sum(${NUMBER('$2')}) a, sum(${NUMBER('$3')}) b from rdv
      where election = $1 and office = 1 and state = $4 group by turn, ${key})
    select ${key}, ${pivot(['a', 'b'])} from r group by ${key}`,
    params: [year, a, b, state],
  }
}

/** All the municipalities with both rounds (the turned places, the larger shifts): state, city as `k` in `state/city` form. */
export const citiesSql = (year, a, b) => ({ sql: `${CITIES} select state, city, ${PIVOT} from c group by state, city`, params: [year, a, b, null] })

/** The two finalists of a runoff, the winner first, with their party and its bloc. */
export const finalistsSql = (year) => ({
  sql: `select n, coalesce(short_name, name) name, party, bloc, official_votes votes from cand_bloc
    where election = $1 and turn = 2 and office = 1 order by official_votes desc nulls last, n limit 2`,
  params: [year],
})

/** Who won the first-round governor race in each municipality, with the bloc of the party. */
export const governorsSql = (year) => ({
  sql: `with g as (select distinct on (state, city) state, city, cand, votes from resx where election = $1 and turn = 1 and office = 3 order by state, city, votes desc)
    select g.state, g.city, g.cand n, b.short_name name, b.party, coalesce(b.bloc, 'N') bloc
    from g left join cand_bloc b on b.election = $1 and b.turn = 1 and b.office = 3 and b.uf = g.state and b.n = g.cand`,
  params: [year],
})

/** The finalist (`a` or `b`) a governor is linked to by side, `null` when the governor is of the center, of no known bloc or of the side of neither. */
export const linkedTo = (governorBloc, a, b) => {
  const side = sideOf(governorBloc)
  if (side === 'center' || side === 'none') return null
  const [sa, sb] = [sideOf(a.bloc), sideOf(b.bloc)]
  return sa === side && sb !== side ? 'a' : sb === side && sa !== side ? 'b' : null
}

const winner = (a, b) => (a === b ? null : a > b ? 'a' : 'b')

/** A row of `childrenSql` with the changes and the reconciliation of the identity (`gap` is 0 when the sources agree). */
export function shiftOf(r) {
  const [abs1, abs2] = [r.ap1 - r.co1, r.ap2 - r.co2]
  const d = { a: r.a2 - r.a1, b: r.b2 - r.b1, nu: r.nu2 - r.nu1, bl: r.bl2 - r.bl1, abs: abs2 - abs1, ap: r.ap2 - r.ap1 }
  const others1 = r.nom1 - r.a1 - r.b1
  const result = others1 - d.nu - d.bl - d.abs + d.ap
  const [w1, w2] = [winner(r.a1, r.b1), winner(r.a2, r.b2)]
  return { ...r, abs1, abs2, others1, d, result, gap: d.a + d.b - result, w1, w2, turned: !!w1 && !!w2 && w1 !== w2 }
}

/** The sum of rows of `shiftOf`: the identity holds for the total as for each place. */
export const totalOf = (rows) => shiftOf(COLUMNS.flatMap((c) => [`${c}1`, `${c}2`]).reduce((t, k) => ({ ...t, [k]: rows.reduce((s, r) => s + (r[k] ?? 0), 0) }), {}))

/** A new vote can come from the pool the first round left (others) and from those that stopped abstaining, voting blank or null; this splits the gain of the finalists by pool, as signed numbers. */
export const pools = (s) => [
  { id: 'others', value: s.others1 },
  { id: 'nu', value: -s.d.nu },
  { id: 'bl', value: -s.d.bl },
  { id: 'abs', value: -s.d.abs },
  { id: 'ap', value: s.d.ap },
]

/** Share of the gain of the finalists a pool accounts for, nothing when the net gain is zero. */
export const poolShare = (value, s) => (s.d.a + s.d.b === 0 ? null : value / (s.d.a + s.d.b))

// ---- who received the votes: the first-round groups against the runoff outcomes, place by place (src/estimate.js) -------------------------------------------

/** The first-round candidates with their party, bloc and the finalist they declared for in the runoff. */
export const rosterSql = (year) => ({
  sql: `select c.n, coalesce(c.short_name, c.name) name, c.party, c.bloc, e.to_n declared, c.official_votes votes from cand_bloc c
    left join endorsement e on e.election = $1 and e.turn = 2 and e.n = c.n where c.election = $1 and c.turn = 1 and c.office = 1 order by c.official_votes desc nulls last, c.n`,
  params: [year],
})

/** The places to estimate from, for the place in `args`: the municipalities of the country or the state, the sections of a city or a zone. `places` has one row per place and round, `votes` the first-round votes by candidate. */
export function estimateUnitsSql(args, year, a, b) {
  const [state, city, zone] = args
  if (!city) {
    return {
      places: { sql: `${CITIES} select turn, state || '/' || city k, a, b, nom, bl, nu, ap, co from c`, params: [year, a, b, state ?? null] },
      votes: { sql: `select state || '/' || city k, cand, sum(votes)::bigint votes from resx where election = $1 and turn = 1 and office = 1 and ($2::text is null or state = $2) group by 1, 2`, params: [year, state ?? null] },
    }
  }
  const at = ' and ($4::text is null or zone = $4)'
  return {
    places: {
      sql: `with r as (select turn, zone, section, sum(${NUMBER('$5')}) a, sum(${NUMBER('$6')}) b, sum(nominal) nom, sum(blank) bl, sum(nul) nu from rdv where election = $1 and office = 1 and state = $2 and city = $3${at} group by turn, zone, section),
        g as (select turn, zone, section, sum(aptos) ap, sum(comp) co from sg where election = $1 and state = $2 and city = $3${at} group by turn, zone, section)
        select turn, zone || '/' || section k, a, b, nom, bl, nu, ap, co from r full join g using (turn, zone, section)`,
      params: [year, state, city, zone ?? null, a, b],
    },
    votes: { sql: `select zone || '/' || section k, cand, votes from cs where election = $1 and turn = 1 and office = 1 and state = $2 and city = $3${at}`, params: [year, state, city, zone ?? null] },
  }
}

const ZERO = (v) => Number(v ?? 0)

/**
 * The first-round groups against the runoff outcomes for every place that voted in both rounds. Groups: the finalists `a` and `b`, each candidate with at
 * least `MIN_SHARE` of the votes or a declared support, the others together, blank and null, abstention. Outcomes: a, b, blank and null, abstention. The first round is scaled to the
 * electorate of the runoff, so that a place that grew or shrank is compared with itself.
 */
export function unitsOf({ places, votes }, roster, a, b) {
  const byPlace = new Map()
  for (const r of places) byPlace.set(r.k, { ...byPlace.get(r.k), [r.turn]: { a: ZERO(r.a), b: ZERO(r.b), nom: ZERO(r.nom), bl: ZERO(r.bl), nu: ZERO(r.nu), ap: ZERO(r.ap), co: ZERO(r.co) } })
  const cast = new Map()
  for (const v of votes) cast.set(v.k, { ...cast.get(v.k), [v.cand]: ZERO(v.votes) })
  const total = [...byPlace.values()].reduce((n, p) => n + (p[1]?.nom ?? 0), 0)
  const listed = roster.filter((c) => c.n !== a && c.n !== b && (c.declared || ZERO(c.votes) >= MIN_SHARE * total))
  const groups = [{ id: 'a', n: a }, { id: 'b', n: b }, ...listed.map((c) => ({ id: 'c', n: c.n })), { id: 'rest' }, { id: 'blank' }, { id: 'abstention' }]
  const units = []
  for (const [k, p] of byPlace) {
    if (!p[1] || !p[2] || !p[1].ap || !p[2].ap) continue
    const [r1, r2, c] = [p[1], p[2], cast.get(k) ?? {}]
    const scale = r2.ap / r1.ap
    const named = listed.map((o) => ZERO(c[o.n]))
    const x = [r1.a, r1.b, ...named, Math.max(r1.nom - r1.a - r1.b - named.reduce((s, v) => s + v, 0), 0), r1.bl + r1.nu, r1.ap - r1.co].map((v) => v * scale)
    units.push({ k, group: k.split('/')[0], x, y: [r2.a, r2.b, r2.bl + r2.nu, r2.ap - r2.co] })
  }
  return { units, groups }
}

export const MIN_SHARE = 0.005 // a first-round candidate with less than this share of the votes and no declared support goes into the remaining candidates

export const OUTCOMES = ['a', 'b', 'blank', 'abstention']

const mergeRest = (u, rest) => ({ x: [u.x[0], u.x[1], rest.reduce((n, i) => n + u.x[i], 0), ...u.x.slice(-2)], y: u.y })
const sumBy = (units, f) => units.reduce((n, u) => n + f(u), 0)

/** `row` with `keep` of the voters staying in `column` and the rest spread as `row` spreads them over the other columns. */
const staying = (row, column, keep) => {
  const others = row.reduce((n, v, j) => n + (j === column ? 0 : v), 0)
  return row.map((v, j) => (j === column ? keep : (v * (1 - keep)) / others))
}

/**
 * The estimate with, for each group, its votes, where they went (shares and bounds) and the declared support. It is made in two steps: the eliminated
 * candidates together (a group large enough to be told apart from the finalists, blank and abstention) and then each of them, held close to what the
 * eliminated did together, so a candidate moves away from the group only where the places show it. Blank and null and abstention are held close to the
 * least movement the totals allow (only the drop of the group has to leave it). The declared support is never used to estimate.
 */
export function transfersOf(data, roster, a, b) {
  const { units, groups } = unitsOf(data, roster, a, b)
  if (!units.length) return null
  const [blank, abstention] = [groups.length - 2, groups.length - 1]
  const rest = groups.flatMap((g, i) => (g.id === 'c' || g.id === 'rest' ? [i] : []))
  const together = estimate(units.map((u) => mergeRest(u, rest)), { boot: 0, ridge: 1e-3 }).T
  const keep = (i, outcome) => Math.min(1, sumBy(units, (u) => u.y[outcome]) / sumBy(units, (u) => u.x[i]))
  const prior = groups.map((_, i) => (i === blank ? staying(together[2], 2, keep(i, 2)) : i === abstention ? staying(together[2], 3, keep(i, 3)) : together[rest.includes(i) ? 2 : i]))
  const est = estimate(units, { ridge: 1e-2, sensitivity: [1e-3, 1e-1], boot: 20, prior })
  const names = new Map(roster.map((c) => [c.n, c]))
  const rows = groups.map((g, i) => {
    const votes = sumBy(units, (u) => u.x[i])
    return { ...g, ...(names.get(g.n) ?? {}), votes, share: est.T[i], low: est.low[i], high: est.high[i], to: est.T[i].map((s) => s * votes) }
  })
  return { rows, places: units.length, fit: est.fit, thin: units.length < 4 * groups.length, declared: declaredOf(rows, a, b) }
}

/** What the declared support would give if every voter followed it, against what each finalist gained and what the estimate says followed. */
export function declaredOf(rows, a, b) {
  const side = (n) => rows.filter((r) => r.id === 'c' && r.declared === n)
  return [a, b].map((n, k) => {
    const [own, followers] = [rows[k], side(n)]
    return { n, base: own.votes, declared: followers.reduce((s, r) => s + r.votes, 0), followed: followers.reduce((s, r) => s + r.to[k], 0), kept: own.to[k], final: rows.reduce((s, r) => s + r.to[k], 0) }
  })
}
