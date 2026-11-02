// The shift between the two rounds of a presidential election, from round 1 to round 2, for the two finalists (a = the runoff winner, b = the other):
//   Δa + Δb = others₁ − Δnull − Δblank − Δabstention + Δelectorate
// because every round splits the electorate into votes for a candidate, blank, null and abstention. Nothing here says where a voter came from:
// the ballot is secret, so the identity only bounds how many new votes the finalists received and from which pool.
// Children of a place come from the municipality rollups (res, tot, sgz) down to the city and from the sections (rdv, sg) below it.
import { ELECTIONS, ELECTION_LIST, supportsView } from './model.js'
import { sideOf } from './spectrum.js'

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

/** The first-round votes of the candidates that did not reach the runoff in the place, with the finalist each declared for (if known). */
export function othersSql(args, year, a, b) {
  const [state, city, zone] = args
  const who = `left join cands c on c.election = $1 and c.turn = 1 and c.office = 1 and c.n = o.cand left join endorsement d on d.election = $1 and d.turn = 2 and d.n = o.cand`
  const head = `select o.cand n, coalesce(c.short_name, c.name) name, c.party, d.to_n declared, sum(o.votes)::bigint votes`
  const tail = `group by o.cand, c.short_name, c.name, c.party, d.to_n order by votes desc`
  if (!city) {
    return { sql: `${head} from resx o ${who} where o.election = $1 and o.turn = 1 and o.office = 1 and o.cand not in ($2, $3) and ($4::text is null or o.state = $4) ${tail}`, params: [year, a, b, state ?? null] }
  }
  return {
    sql: `${head} from (select k.key cand, k.value::int votes from rdv r, jsonb_each_text(r.votes) k where r.election = $1 and r.turn = 1 and r.office = 1 and r.state = $4 and r.city = $5 ${zone ? 'and r.zone = $6' : ''}) o ${who} where o.cand not in ($2, $3) ${tail}`,
    params: [year, a, b, state, city, ...(zone ? [zone] : [])],
  }
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
