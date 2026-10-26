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

// Fernando de Noronha's clock is UTC-2; its polls open at 09:00 local time (08:00 Brasilia).
const FIXED_TZ = { 'pe/FERNANDO DE NORONHA': 1 }

/** City buckets shared by the city, state and national time charts, from the section CSV rows. */
export function votingTimeRollups(state, lines) {
  const rows = []
  const cities = new Map()
  for (const line of lines) {
    const [head, b] = line.split(',"{')
    if (head.includes('"')) throw new Error(`quoted field, rollup parser needs a CSV reader: ${head}`)
    const f = head.split(',')
    const c = cities.get(f[3]) ?? { sections: 0, n: 0, first: Infinity, b: Array(NB).fill(0) }
    cities.set(f[3], c)
    c.sections++
    c.n += +f[7]
    c.first = Math.min(c.first, +f[8])
    b.slice(0, -2).split(',').forEach((v, i) => (c.b[i] += +v))
  }
  // a late-opening section can only push the estimate up, so cap it at the state's most common value
  const est = new Map([...cities].map(([city, c]) => [city, Math.round((c.first - 8 * 3600 - 300) / 3600)]))
  const all = [...est.values()]
  const mode = [...new Set(all)].sort((a, b) => all.filter((x) => x === b).length - all.filter((x) => x === a).length)[0]
  for (const [city, c] of cities) rows.push([state, city, c.sections, c.n, FIXED_TZ[`${state}/${city}`] ?? Math.min(est.get(city), mode), `{${c.b}}`])
  return rows
}
