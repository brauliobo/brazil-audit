// The left-right reading of an election: the parties folded to the five blocs of the `spectrum` table (scripts/spectrum/parties.csv, an editorial
// choice per party and period). A coalition stands where the average of its parties with a bloc stands (-2 left ... +2 right).
export const BLOCS = ['E', 'CE', 'C', 'CD', 'D', 'N']
export const SIDES = { E: 'left', CE: 'left', C: 'center', CD: 'right', D: 'right', N: 'none' }
export const sideOf = (bloc) => SIDES[bloc] ?? 'none'
export const blocOfScore = (score) => (score == null ? 'N' : ['E', 'CE', 'C', 'CD', 'D'][Math.round(Math.min(Math.max(score, -2), 2)) + 2])

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

/** The most voted candidate for president and for governor in each municipality of a round, with their blocs: one electorate choosing two sides. */
export const paradoxSql = (year, turn) => ({
  sql: `with w as (select distinct on (office, state, city) office, state, city, cand, votes from resx where election = $1 and turn = $2 and office in (1, 3) order by office, state, city, votes desc),
    p as (select w.*, coalesce(b.bloc, 'N') bloc, coalesce(b.short_name, b.name) name from w left join cand_bloc b on b.election = $1 and b.turn = $2 and b.office = w.office
      and b.uf = case w.office when 1 then 'br' else w.state end and b.n = w.cand)
    select pr.state, pr.city, pr.name pname, pr.bloc pbloc, pr.votes::bigint pvotes, g.name gname, g.bloc gbloc, g.votes::bigint gvotes
    from p pr join p g on g.office = 3 and g.state = pr.state and g.city = pr.city where pr.office = 1`,
  params: [year, turn],
})

/** The municipalities whose winners for president and governor stand on opposite sides (left against right), the largest first. */
export const paradoxes = (rows) => rows.filter((r) => ['left,right', 'right,left'].includes(`${sideOf(r.pbloc)},${sideOf(r.gbloc)}`)).sort((a, b) => b.pvotes - a.pvotes)

/** Municipalities by the side of the winner for president (rows) and for governor (columns). */
export const crossTab = (rows) => {
  const sides = ['left', 'center', 'right', 'none']
  const count = (p, g) => rows.filter((r) => sideOf(r.pbloc) === p && sideOf(r.gbloc) === g).length
  return sides.map((p) => ({ side: p, cells: sides.map((g) => ({ side: g, n: count(p, g) })) }))
}
