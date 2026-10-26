// Voting-time statistics for the selected election, shared by the data builder and regression tests.
const T0 = 18000
const STEP = 600
const NB = 90
const q = (s) => `'${s.replaceAll("'", "''")}'`

// Logs can retain voting events from earlier rounds; select the polling day before gaps or buckets are computed.
const onDay = (el) => `v.time >= ${q(el.date)}::timestamp and v.time < ${q(el.date)}::timestamp + interval '1 day'`

// the bucketing and statistics shared by both sources
const VT_TAIL = (el, s, city) => `b as (select *,least(greatest((sc-${T0})/${STEP},0),${NB - 1}) bk from e)
  select ${el.year},${el.turn},${q(s)},${q(city)},zone,section,model,count(*),min(sc),max(sc),round(percentile_cont(.5) within group (order by gap)),
  round(percentile_cont(.1) within group (order by gap)),round(percentile_cont(.9) within group (order by gap)),max(gap),
  '{'||concat_ws(',',${buckets})||'}' from b group by zone,section,model order by zone,section,model`

// ---- vt: voting times (Presidente post only, one event per voter), computed in Postgres per state ---------------------------
const buckets = Array.from({ length: NB }, (_, i) => `count(*) filter (where bk=${i})`).join(',')
// One index probe per section (state,city,zone,section,model,post prefix): ~300x faster than scanning the city's range
// and filtering post, because the index puts post after model. Sections come from rdv_votes (the scraped results).
export const vtSql = (el, s, city) => (el.source.kind === 'machine' ? vtMachineSql(el, s, city) : vtRdvSql(el, s, city))

// 2022: voting_times has the TSE city code and the round, and its index is (state, city_code, zone, section, turn): the post is filtered after the probe
const vtMachineSql = (el, s, city) => `with e as (select sec.zone,sec.section,sec.model,x.sc,x.sc-lag(x.sc) over (partition by sec.zone,sec.section order by x.time) gap
  from (select zone,section,model,city_code from rdv_machine where state=${q(s)} and city=${q(city)} and office=1 and turn=${el.turn}) sec
  cross join lateral (select time,(extract(epoch from time)::bigint % 86400)::int sc from voting_times v where v.state=${q(s)} and v.city_code=sec.city_code
    and v.zone=sec.zone and v.section=sec.section and v.turn=${el.turn} and v.post='Presidente' and ${onDay(el)}) x),
  ${VT_TAIL(el, s, city)}`

const vtRdvSql = (el, s, city) => `with e as (select sec.zone,sec.section,sec.model,x.sc,x.sc-lag(x.sc) over (partition by sec.zone,sec.section,sec.model order by x.time) gap
  from (select zone,section,model from rdv_votes where state=${q(s)} and city=${q(city)} and office=1) sec
  cross join lateral (select time,(extract(epoch from time)::bigint % 86400)::int sc from voting_times v where v.state=${q(s)} and v.city=${q(city)}
    and v.zone=sec.zone and v.section=sec.section and v.model=sec.model and v.post='Presidente' and ${onDay(el)}) x),
  ${VT_TAIL(el, s, city)}`
