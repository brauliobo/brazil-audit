// Parameters: canonical contest, UF ('br' sums presidential UF bounds), office, municipality for mayoral contests.
const SCOPE = `with scoped as (
  select * from state_rounds r
  where r.contest_id = $1 and r.office = $3
    and (r.state = $2 or ($2::text = 'br' and r.office = 1))
    and (r.office <> 11 or r.city is not distinct from $4::text)
)`
const CHECKED = `${SCOPE}, counted as (
  select r.contest_id,r.state,r.turn,coalesce(sum(c.count),0) votes,
    count(*) filter (where c.category_id is not null and c.count is null) unknown_counts,
    count(*) filter (where c.count < 0) negative_counts
  from scoped r left join state_round_counts c using (contest_id,state,turn)
  group by r.contest_id,r.state,r.turn
), checked as (
  select r.*,v.votes,v.unknown_counts,v.negative_counts
  from scoped r join counted v using (contest_id,state,turn)
), first_round as (select * from checked where turn = 1),
second_round as (select * from checked where turn = 2), paired as (
  select coalesce(a.state,b.state) state,coalesce(a.city,b.city) city,
    a.election_id first_election,b.election_id second_election,
    a.electorate first_electorate,b.electorate second_electorate,
    a.installed first_installed,b.installed second_installed,
    a.present first_present,b.present second_present,a.absent first_absent,b.absent second_absent,
    case when a.electorate is not null and b.electorate is not null then greatest(a.electorate,b.electorate) end population,
    case when a.turnout_complete and b.turnout_complete
      and a.electorate >= 0 and b.electorate >= 0 and a.installed >= 0 and b.installed >= 0
      and a.present >= 0 and b.present >= 0 and a.absent >= 0 and b.absent >= 0
      and a.not_installed >= 0 and b.not_installed >= 0
      and a.present+a.absent = a.installed and b.present+b.absent = b.installed
      and a.installed+a.not_installed = a.electorate and b.installed+b.not_installed = b.electorate
      then true else false end population_valid,
    case when a.votes_complete and b.votes_complete and a.votes = a.present and b.votes = b.present
      and a.unknown_counts = 0 and b.unknown_counts = 0 and a.negative_counts = 0 and b.negative_counts = 0
      then true else false end votes_valid
  from first_round a full join second_round b using (contest_id,state)
), units as (
  select *,population_valid and votes_valid valid,
    case when first_election is null or second_election is null then 'missing_round'
      when not population_valid then 'invalid_population'
      when not votes_valid then 'invalid_vote_partition' end reason
  from paired
)`
const VOTE_VALUES = `select r.state,r.turn,c.category_id,c.label,c.candidate_id,c.count n
  from scoped r join state_round_counts c using (contest_id,state,turn)`
const OBSERVED_VALUES = `${VOTE_VALUES}
  union all select state,turn,'abstention','abstention',null,absent from scoped
  union all select state,turn,'not_installed','not_installed',null,not_installed from scoped`

export const transferMetadataSql = `select contest_id,year,office,state,city,min(description) description,
  min(date)::text first_date,max(date)::text last_date,count(distinct turn)::int turns
  from state_rounds where office in (1,3,11) and year = $1 group by contest_id,year,office,state,city
  having bool_or(turn = 1) and bool_or(turn = 2) order by year desc,first_date desc,office,state,city`
export const transferRoundsSql = `${SCOPE}
  select election_id,year,date::text date,office,state,city,turn,electorate,installed,present,absent,not_installed,
    turnout_complete,votes_complete,source_url,source_sha256 from scoped order by state,turn`
export const transferObservedSql = `${SCOPE}, observed as (${OBSERVED_VALUES})
  select * from observed order by state,turn,category_id`
export const transferUnitsSql = `${CHECKED} select * from units order by state`
export const transferBoundsSql = `${CHECKED}, valid_units as (select * from units where valid),
  observed as (${OBSERVED_VALUES}), scenario_values as (
    select o.* from observed o join valid_units u using (state)
    union all select r.state,r.turn,'administrative_balance','administrative_balance',null,u.population-r.electorate
      from scoped r join valid_units u using (state)
  ), axes as (
    select turn,category_id,max(label) label,max(candidate_id) candidate_id,sum(n) total
    from scenario_values group by turn,category_id having sum(n) > 0
  )
  select a.category_id from_id,a.label from_label,a.candidate_id from_candidate_id,a.total::float8 from_total,
    b.category_id to_id,b.label to_label,b.candidate_id to_candidate_id,b.total::float8 to_total,
    sum(greatest(0,coalesce(x.n,0)+coalesce(y.n,0)-u.population))::float8 bound_low,
    sum(least(coalesce(x.n,0),coalesce(y.n,0)))::float8 bound_high
  from valid_units u cross join axes a cross join axes b
    left join scenario_values x on x.state = u.state and x.turn = 1 and x.category_id = a.category_id
    left join scenario_values y on y.state = u.state and y.turn = 2 and y.category_id = b.category_id
  where a.turn = 1 and b.turn = 2
  group by a.category_id,a.label,a.candidate_id,a.total,b.category_id,b.label,b.candidate_id,b.total
  order by a.total desc,a.category_id,b.total desc,b.category_id`
