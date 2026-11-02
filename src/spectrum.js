// The left-right reading of an election: the parties folded to the five blocs of the `spectrum` table (scripts/spectrum/parties.csv, an editorial
// choice per party and period). A coalition stands where the average of its parties with a bloc stands (-2 left ... +2 right).
export const BLOCS = ['E', 'CE', 'C', 'CD', 'D', 'N']
export const SIDES = { E: 'left', CE: 'left', C: 'center', CD: 'right', D: 'right', N: 'none' }
export const sideOf = (bloc) => SIDES[bloc] ?? 'none'
export const blocOfScore = (score) => (score == null ? 'N' : ['E', 'CE', 'C', 'CD', 'D'][Math.round(Math.min(Math.max(score, -2), 2)) + 2])

/** The party as written in the TSE files and in `cands` folded to one key: `PC do B` and `PCDOB` are the same party. */
export const partyKey = (p) => String(p ?? '').toUpperCase().replace(/[^A-Z0-9ÃÕÇ]/g, '')

/** The bloc of a party in a year from the rows of the `spectrum` table (`N` when it has none). */
const N = (v) => Number(v ?? 0)

export const blocOf = (party, year, rows) => rows.find((r) => r.party === partyKey(party) && year >= r.from_year && year <= r.to_year)?.bloc ?? 'N'

const PARTY = (col) => `regexp_replace(upper(${col}), '[^A-Z0-9ÃÕÇ]', '', 'g')` // i18n-ignore
const SCORE = `case s.bloc when 'E' then -2 when 'CE' then -1 when 'C' then 0 when 'CD' then 1 when 'D' then 2 end`

// the candidates of `candidatesSql` with the bloc of the party in the year of the election
const joined = (inner, year) => ({
  sql: `with c as (${inner.sql}) select c.cand, c.number, coalesce(c.short_name, c.name) name, c.party_label party, c.votes::bigint votes, coalesce(s.bloc, 'N') bloc
    from c left join spectrum s on s.party = ${PARTY('c.party_label')} and ${+year} between s.from_year and s.to_year`,
  params: inner.params,
})

/** Votes and candidates of each bloc. */
export const blocsSql = (inner, year) => {
  const j = joined(inner, year)
  return { sql: `select bloc, coalesce(sum(votes), 0)::bigint votes, count(*)::int candidates from (${j.sql}) b group by bloc`, params: j.params }
}

/** The most voted candidates with their bloc. */
export const topSql = (inner, year, limit = 25) => {
  const j = joined(inner, year)
  return { sql: `${j.sql} order by votes desc nulls last limit ${+limit}`, params: j.params }
}

/** Coalitions, federations and isolated parties of an office (all the states when `uf` is null), with the average position of their parties. */
export const coalitionsSql = (year, turn, office, uf) => ({
  sql: `select c.uf, c.seq, c.name, max(c.kind) kind, count(*)::int parties, count(s.bloc)::int known,
      string_agg(c.party || coalesce(' (' || s.bloc || ')', ''), ', ' order by c.party) members, avg(${SCORE})::float score
    from coalition c left join spectrum s on s.party = c.party and c.election between s.from_year and s.to_year
    where c.election = $1 and c.turn = $2 and c.office = $3 and ($4::text is null or c.uf = $4) and coalesce(c.status, '') !~ '^(indefer|invalidado)'
    group by c.uf, c.seq, c.name, case when c.kind = 'party' then c.party end order by parties desc, c.uf, c.seq, c.name`,
  params: [year, turn, office, uf],
})

/** The most voted candidate of each municipality with the bloc of the party: `votes` are rows (state, city, number, votes) and `candidates` the roster (state, number, name, party). */
export function winnersOf(votes, candidates, spectrum, year) {
  const best = new Map()
  const total = new Map()
  for (const v of votes) total.set(`${v.state}|${v.city}|${v.number}`, (total.get(`${v.state}|${v.city}|${v.number}`) ?? 0) + N(v.votes))
  for (const [k, n] of total) {
    const [state, city, number] = k.split('|')
    if (n > (best.get(`${state}|${city}`)?.votes ?? -1)) best.set(`${state}|${city}`, { state, number, votes: n })
  }
  return new Map([...best].map(([k, g]) => {
    const who = candidates.find((c) => c.state === g.state && c.number === g.number) ?? candidates.find((c) => c.number === g.number)
    return [k, { ...g, name: who?.name ?? g.number, party: who?.party ?? '', bloc: blocOf(who?.party, year, spectrum) }]
  }))
}

/** The municipalities where president and governor were both voted, with the winner of each and its bloc: one electorate choosing two offices. */
export function paradoxOf(president, governor) {
  return [...president].filter(([k]) => governor.has(k)).map(([k, p]) => {
    const g = governor.get(k)
    return { state: p.state, city: k.split('|')[1], pname: p.name, pbloc: p.bloc, pvotes: p.votes, gname: g.name, gbloc: g.bloc, gvotes: g.votes }
  })
}

/** The municipalities whose winners for president and governor stand on opposite sides (left against right), the largest first. */
export const paradoxes = (rows) => rows.filter((r) => ['left,right', 'right,left'].includes(`${sideOf(r.pbloc)},${sideOf(r.gbloc)}`)).sort((a, b) => b.pvotes - a.pvotes)

/** Municipalities by the side of the winner for president (rows) and for governor (columns). */
export const crossTab = (rows) => {
  const sides = ['left', 'center', 'right', 'none']
  const count = (p, g) => rows.filter((r) => sideOf(r.pbloc) === p && sideOf(r.gbloc) === g).length
  return sides.map((p) => ({ side: p, cells: sides.map((g) => ({ side: g, n: count(p, g) })) }))
}
