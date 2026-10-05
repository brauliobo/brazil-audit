// One adapter per source kind of src/elections.js (`source.kind`): the SQL (read-only, on the election's source database) that
// turns its section results into the two shapes the pipeline works with. A new election or round is a config entry in
// src/elections.js; nothing here names a year.
//   sec  (election, turn, office, id, uf, city, size)   one row per section and office; size = nominal + blank + null votes
//   fact (election, turn, office, id, cand, votes)      votes > 0 per section: candidates, party blocks (deputies) and the
//                                                       pseudo candidates nominal / branco / nulo (the section totals)
// Ids are row numbers over the section key; both queries run in one repeatable-read snapshot, so they agree.
// Both kinds read rdv_votes(state, city, zone, section, office, votes jsonb): 'rdv' is the 2026 collector (one round, an urn model
// column), 'open' the TSE open-data collector of 2018/2022 (both rounds in one table, told apart by a `turn` column).

const sumOf = (...kinds) => kinds.map((k) => `(select coalesce(sum(value::int), 0) from jsonb_each_text(votes->'${k}'))`).join('+')
const PARTY_OFFICES = [6, 7, 8] // deputies: candidates are too many and too small, the party block (first two digits) is the series

const TOTALS = `select id, 'nominal', nom from s where nom > 0 union all select id, 'branco', bl from s where bl > 0 union all select id, 'nulo', nu from s where nu > 0`

const collector = ({ year, turn, source }) => (office) => {
  const s = `with s as (select row_number() over (order by state, city, zone, section) id, state, city, votes, ${sumOf(2)} nom, ${sumOf(3)} bl, ${sumOf(4, 6, 7)} nu
    from rdv_votes where office = ${office}${source.kind === 'open' ? ` and turn = ${turn}` : ''})`
  const value = PARTY_OFFICES.includes(office)
    ? `select s.id, 'p' || left(e.key, 2), sum(e.value::int) from s, jsonb_each_text(s.votes->'2') e group by 1, 2`
    : `select s.id, e.key, e.value::int from s, jsonb_each_text(s.votes->'2') e where e.value::int > 0`
  return {
    sec: `${s} select ${year}, ${turn}, ${office}, id, state, city, nom + bl + nu from s`,
    fact: `${s} select ${year}, ${turn}, ${office}, f.* from (${value} union all ${TOTALS}) f`,
  }
}

export const ADAPTERS = { rdv: collector, open: collector }
