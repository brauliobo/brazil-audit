export function competitionQuery(id, election, source) {
  const party = id.startsWith('party_')
  const group = party ? "coalesce(c.party, '__unknown_party__')" : "case when r.office = 1 then r.cand else r.state || ':' || r.cand end"
  const chosen = "case when $4::text = '' then rn = 1 else candidate = $4 end"
  const expression = {
    candidate_votes: `sum(votes) filter (where ${chosen})`, candidate_share: `sum(votes) filter (where ${chosen})`, candidate_rank: `max(rn) filter (where ${chosen})`,
    winner_rate: 'max(votes) filter (where rn = 1)', lead_margin: 'max(votes) filter (where rn = 1) - coalesce(max(votes) filter (where rn = 2), 0)',
    effective_candidates: 'power(sum(votes),2) / nullif(sum(power(votes,2)),0)', candidate_hhi: 'sum(power(votes,2)) / nullif(power(sum(votes),2),0)', candidate_count: 'count(*)',
    party_votes: `sum(votes) filter (where ${chosen})`, party_share: `sum(votes) filter (where ${chosen})`, party_count: "count(*) filter (where candidate <> '__unknown_party__')",
  }[id]
  const rate = ['candidate_share','winner_rate','lead_margin','party_share'].includes(id)
  return `with votes as (select ${group} candidate, max(${party ? 'c.party' : 'c.short_name'}) label, sum(r.votes)::float8 votes from ${source} r
    left join cands c on c.election = r.election and c.turn = r.turn and c.office = r.office and c.n = r.cand and c.uf = case when r.office = 1 then 'br' else r.state end
    where r.election = ${election.year} and r.turn = ${election.turn} and r.office = $3 and ($1::text = '' or r.state = $1) and ($2::text = '' or r.city = $2)
    group by ${group}), ranked as (select *, row_number() over (order by votes desc,candidate) rn from votes)
    select ${expression}::float8 numerator, ${rate ? 'sum(votes)' : 'null'}::float8 denominator, count(*) records,
      max(coalesce(label,candidate)) filter (where ${chosen}) target from ranked`
}


export function comparisonTargetsQuery(election,source,party=false) {
  const group = party ? "coalesce(c.party, '__unknown_party__')" : "case when r.office = 1 then r.cand else r.state || ':' || r.cand end"
  return `select ${group} cand,max(${party ? 'c.party' : 'c.short_name'}) label,sum(r.votes)::float8 votes from ${source} r
    left join cands c on c.election = r.election and c.turn = r.turn and c.office = r.office and c.n = r.cand and c.uf = case when r.office = 1 then 'br' else r.state end
    where r.election = ${election.year} and r.turn = ${election.turn} and r.office = $3 and ($1::text = '' or r.state = $1) and ($2::text = '' or r.city = $2)
    group by ${group} order by votes desc,cand`
}
