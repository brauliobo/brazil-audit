// The shift between the two rounds of a runoff, for the two finalists (a = the runoff winner, b = the other):
//   Δa + Δb = others₁ − Δnull − Δblank − Δabstention + Δelectorate
// because every round splits the electorate into votes for a candidate, blank, null and abstention. Nothing here says where a voter came from:
// the ballot is secret, so the identity only bounds how many new votes the finalists received and from which pool, and `transfersOf` estimates the rest.
// The places are the units of src/contest.js (zones, or municipalities where the source has no zones); every level above is their sum.
import { sideOf, blocOf, winnersOf } from './spectrum.js'
export const governorsOf = winnersOf
import { estimate } from './estimate.js'

export const LEVELS = ['country', 'state', 'city', 'zone']
export const levelOf = (args) => LEVELS[Math.min(args.length, 3)]

const COLUMNS = ['a', 'b', 'nom', 'bl', 'nu', 'ap', 'co']
const N = (v) => Number(v ?? 0)
const winner = (a, b) => (a === b ? null : a > b ? 'a' : 'b')

/** The finalists of a contest: its two most voted candidates in the runoff, the winner first. */
export function finalistsOf(votes) {
  const total = new Map()
  for (const v of votes) if (v.turn === 2) total.set(v.number, (total.get(v.number) ?? 0) + N(v.votes))
  return [...total].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1)).slice(0, 2).map(([number]) => number)
}

/** The places of a contest that voted in both rounds: the finalists' votes, the rest of the nominal votes, blank, null, electorate and turnout of each round, and the first-round votes by candidate. */
export function placesOf(rows, votes, a, b) {
  const places = new Map()
  const place = (r) => {
    const k = `${r.state}|${r.city ?? ''}|${r.zone ?? ''}`
    if (!places.has(k)) places.set(k, { state: r.state, city: r.city ?? '', zone: r.zone ?? '', 1: null, 2: null, cast: {} })
    return places.get(k)
  }
  for (const r of rows) place(r)[r.turn] = { a: 0, b: 0, nom: N(r.nominal), bl: N(r.blank), nu: N(r.nul), ap: N(r.eligible), co: N(r.present) }
  for (const v of votes) {
    const p = place(v)
    if (!p[v.turn]) continue
    if (v.number === a) p[v.turn].a += N(v.votes)
    else if (v.number === b) p[v.turn].b += N(v.votes)
    p[v.turn].cands = (p[v.turn].cands ?? 0) + N(v.votes)
    if (v.turn === 1) p.cast[v.number] = (p.cast[v.number] ?? 0) + N(v.votes)
  }
  for (const p of places.values()) for (const t of [1, 2]) if (p[t] && !p[t].nom) p[t].nom = p[t].cands ?? 0 // older sources give the candidates' votes but not the nominal total
  return [...places.values()].filter((p) => p[1] && p[2])
}

const ROW = (p) => COLUMNS.reduce((r, c) => ({ ...r, [`${c}1`]: p[1][c], [`${c}2`]: p[2][c] }), {})
const SUM = (rows) => rows.reduce((t, r) => Object.fromEntries(Object.keys(r).map((k) => [k, (t[k] ?? 0) + r[k]])), {})

/** The places inside the place in `args` ([state, city, zone]). */
export const within = (places, args) => places.filter((p) => args.every((v, i) => v === [p.state, p.city, p.zone][i]))

/** The children of the place in `args`: one row per state, municipality or zone, with both rounds, and the identity for each. */
export function childrenOf(places, args) {
  const depth = Math.min(args.length, 2)
  const groups = new Map()
  for (const p of within(places, args)) {
    const parts = [p.state, p.city, p.zone].slice(0, depth + 1)
    const k = parts.join('|')
    groups.set(k, { k: parts[depth], state: p.state, city: p.city, zone: depth === 2 ? p.zone : '', rows: [...(groups.get(k)?.rows ?? []), ROW(p)] })
  }
  return [...groups.values()].map(({ rows, ...g }) => shiftOf({ ...g, ...SUM(rows) }))
}

/** Every municipality with both rounds (a municipality grain row when the source has no zones). */
export function citiesOf(places) {
  const groups = new Map()
  for (const p of places) groups.set(`${p.state}|${p.city}`, { state: p.state, city: p.city, rows: [...(groups.get(`${p.state}|${p.city}`)?.rows ?? []), ROW(p)] })
  return [...groups.values()].map(({ rows, ...g }) => shiftOf({ ...g, ...SUM(rows) }))
}

/** A row with the changes and the reconciliation of the identity (`gap` is 0 when the sources agree). */
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

/** The contests of an office from its places: one per state for governor, one per municipality for mayor, one for the country for a president. */
export function contestsOf(rows, votes, depth) {
  const key = (r) => [r.state, r.city].slice(0, depth).join('|')
  const groups = new Map()
  for (const r of rows) groups.set(key(r), { rows: [...(groups.get(key(r))?.rows ?? []), r], votes: [] })
  for (const v of votes) groups.get(key(v))?.votes.push(v)
  return [...groups].map(([k, g]) => {
    const [a, b] = finalistsOf(g.votes)
    const places = placesOf(g.rows, g.votes, a, b)
    return { key: k, state: g.rows[0].state, city: depth > 1 ? g.rows[0].city : '', a, b, places, ...(places.length ? { total: totalOf(places.map(ROW)) } : {}) }
  }).filter((c) => c.b != null)
}

/** The finalist (`a` or `b`) a governor is linked to by side, `null` when the governor is of the center, of no known bloc or of the side of neither. */
export const linkedTo = (governorBloc, a, b) => {
  const side = sideOf(governorBloc)
  if (side === 'center' || side === 'none') return null
  const [sa, sb] = [sideOf(a.bloc), sideOf(b.bloc)]
  return sa === side && sb !== side ? 'a' : sb === side && sa !== side ? 'b' : null
}

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

/** The first-round candidates of a contest with their party, bloc, votes in the places and the finalist they declared for (`endorsements` rows: n, to_n). */
export function rosterOf(places, candidates, endorsements, spectrum, year) {
  const votes = {}
  for (const p of places) for (const [n, v] of Object.entries(p.cast)) votes[n] = (votes[n] ?? 0) + v
  const declared = new Map(endorsements.map((e) => [e.n, e.to_n]))
  return candidates.filter((c) => c.number in votes).map((c) => ({ number: c.number, name: c.name, party: c.party, bloc: blocOf(c.party, year, spectrum), votes: votes[c.number], declared: declared.get(c.number) || null })).sort((x, y) => y.votes - x.votes)
}

export const MIN_SHARE = 0.005 // a first-round candidate with less than this share of the votes and no declared support goes into the remaining candidates
export const OUTCOMES = ['a', 'b', 'blank', 'abstention']

/**
 * The first-round groups against the runoff outcomes for every place. Groups: the finalists `a` and `b`, each candidate with at least `MIN_SHARE` of the votes or
 * a declared support, the others together, blank and null, abstention. Outcomes: a, b, blank and null, abstention. The first round is scaled to the electorate of the
 * runoff, so that a place that grew or shrank is compared with itself. `groupOf` names the set of places a place is compared with (its state, its municipality).
 */
export function unitsOf(places, roster, a, b, groupOf) {
  const total = places.reduce((n, p) => n + p[1].nom, 0)
  const listed = roster.filter((c) => c.number !== a && c.number !== b && (c.declared || c.votes >= MIN_SHARE * total))
  const groups = [{ id: 'a', n: a }, { id: 'b', n: b }, ...listed.map((c) => ({ id: 'c', n: c.number })), { id: 'rest' }, { id: 'blank' }, { id: 'abstention' }]
  const units = places.filter((p) => p[1].ap && p[2].ap).map((p) => {
    const [r1, r2] = [p[1], p[2]]
    const scale = r2.ap / r1.ap
    const named = listed.map((o) => p.cast[o.number] ?? 0)
    const x = [r1.a, r1.b, ...named, Math.max(r1.nom - r1.a - r1.b - named.reduce((s, v) => s + v, 0), 0), r1.bl + r1.nu, r1.ap - r1.co].map((v) => v * scale)
    return { group: groupOf(p), x, y: [r2.a, r2.b, r2.bl + r2.nu, r2.ap - r2.co] }
  })
  return { units, groups }
}

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
export function transfersOf(places, roster, a, b, groupOf) {
  const { units, groups } = unitsOf(places, roster, a, b, groupOf)
  if (units.length < 2 * groups.length) return null
  const [blank, abstention] = [groups.length - 2, groups.length - 1]
  const rest = groups.flatMap((g, i) => (g.id === 'c' || g.id === 'rest' ? [i] : []))
  const together = estimate(units.map((u) => mergeRest(u, rest)), { boot: 0, ridge: 1e-3 }).T
  const keep = (i, outcome) => Math.min(1, sumBy(units, (u) => u.y[outcome]) / sumBy(units, (u) => u.x[i]))
  const prior = groups.map((_, i) => (i === blank ? staying(together[2], 2, keep(i, 2)) : i === abstention ? staying(together[2], 3, keep(i, 3)) : together[rest.includes(i) ? 2 : i]))
  const est = estimate(units, { ridge: 1e-2, sensitivity: [1e-3, 1e-1], boot: 20, prior })
  const names = new Map(roster.map((c) => [c.number, c]))
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
