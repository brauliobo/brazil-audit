// Source facts share a query contract; section data retain their actual grain.
import { ELECTIONS } from './model'
import { ensure, ensureSmall, ensureState, parts } from './data'
import { rollup } from './results'

const keyOf = (key, requested) => {
  const cfg = ELECTIONS[key]
  const definitions = cfg.officeDefinitions ?? cfg.sourceSession?.offices ?? []
  const selected = definitions.find((o) => o.key === requested || String(o.id) === String(requested)) ?? definitions[0]
  const numbers = { president: 1, governor: 3, senator: 5, federal_deputy: 6, state_deputy: 7, district_deputy: 8, mayor: 11, councillor: 13 }
  return { cfg, office: selected?.id ?? numbers[requested] ?? requested ?? cfg.offices[0], officeKey: selected?.key ?? requested }
}
const historical = (cfg) => Boolean(cfg.sourceSession && !cfg.legacyKey)
const idsOf = (cfg) => cfg.sourceSession.eventIds
const selectedParts = (table, cfg) => parts(table).filter((id) => cfg.sourceSession.sourceYears.some((year) => id.startsWith(`${year}/`)))

export async function ensureElection(key, officeKey, scope = {}) {
  const { cfg } = keyOf(key, officeKey)
  if (cfg.sourceSession) await ensure('election_units', parts('election_units').filter((id) => id.startsWith(`${cfg.sourceSession.key}/`)))
  if (historical(cfg)) {
    await Promise.all(['election_units', 'election_votes', 'election_candidates'].map((table) => ensure(table,
      table === 'election_units' ? parts(table).filter((id) => id.startsWith(`${cfg.sourceSession.key}/`)) : selectedParts(table, cfg))))
  } else {
    await ensure('cands')
    await ensureSmall(cfg.legacyKey ?? key, 'res', 'tot', 'residual')
    if (scope.zone || scope.section) await ensureState('rdv', cfg.legacyKey ?? key, scope.state)
  }
}

function where(cfg, office, officeKey, scope, alias, params) {
  const add = (value) => { params.push(value); return `$${params.length}` }
  const filters = historical(cfg)
    ? [`${alias}.election_id = any(${add(idsOf(cfg))}::text[])`, `${alias}.office_key = ${add(officeKey)}`]
    : [`${alias}.election = ${add(cfg.year)}`, `${alias}.turn = ${add(cfg.turn)}`, `${alias}.office = ${add(Number(office))}`]
  for (const field of ['state', 'city_code', 'zone', 'section']) {
    if (scope[field] == null || scope[field] === '') continue
    filters.push(`${alias}.${!historical(cfg) && field === 'city_code' ? 'city' : field} = ${add(scope[field])}`)
  }
  return filters.join(' and ')
}

function base(key, officeKey, scope = {}, source = 'votes') {
  const selected = keyOf(key, officeKey)
  const { office, officeKey: canonical } = selected
  const cfg = source === 'units' && selected.cfg.sourceSession ? { ...selected.cfg, legacyKey: null } : selected.cfg
  const params = []
  const filter = where(cfg, office, canonical, scope, 'u', params)
  if (!historical(cfg)) {
    const city = scope.city_code ? ` and city = $${params.indexOf(scope.city_code) + 1}` : ''
    return { cfg, params, office, filter, modern: true, city, res: scope.zone || scope.section ? 'cs' : rollup(cfg.legacyKey ?? key).res, tot: scope.zone || scope.section ? 'sec' : rollup(cfg.legacyKey ?? key).tot }
  }
  // Official national/state/municipality rollups are not additive to their descendants.
  const units = `select * from (select u.*,
      bool_or(grain='national') over (partition by election_id,office_key) _has_national,
      bool_or(grain='state') over (partition by election_id,office_key,state) _has_state,
      bool_or(grain='municipality') over (partition by election_id,office_key,state,city_code) _has_city,
      bool_or(grain='zone') over (partition by election_id,office_key,state,city_code,zone) _has_zone
    from election_units u where ${filter} and coalesce(u.transit,'N') <> 'S') scoped
    where grain='national' or (not _has_national and
      (grain='state' or (not _has_state and (grain='municipality' or
        (not _has_city and (grain='zone' or not _has_zone))))))`
  return { cfg, params, office, modern: false, cte: `u as (${units}), v as (select v.* from election_votes v
    where ${filter.replaceAll('u.', 'v.')} and coalesce(v.transit,'N') <> 'S')` }
}
const completeSum = (column, alias = '') => `case when count(${alias}${column})=count(*) then sum(${alias}${column}) end`

export function totalsSql(key, officeKey, scope = {}) {
  const b = base(key, officeKey, scope, 'units')
  if (b.modern) return { sql: `select ${b.tot === 'sec' ? 'count(*)' : 'sum(sections)'} sections,sum(nominal) nominal,sum(nominal) valid,sum(blank) blank,sum(nul) nul,
    sum(nominal+blank+nul) ballots,null::bigint eligible,null::bigint installed,null::bigint present,null::bigint absent,null::bigint not_installed,
    count(*) units,'municipality'::text grain from ${b.tot} u where ${b.filter}`, params: b.params }
  return { sql: `with ${b.cte} select ${completeSum('sections')} sections,
    ${completeSum('nominal')} nominal,${completeSum('valid')} valid,
    ${completeSum('legend')} legend,${completeSum('blank')} blank,${completeSum('null_votes')} nul,
    ${['ballots','eligible','installed','present','absent','not_installed'].map((f) => `${completeSum(f)} ${f}`).join(',')},
    count(*) units,string_agg(distinct grain,',') grain from u`, params: b.params }
}

export function candidatesSql(key, officeKey, scope = {}) {
  const b = base(key, officeKey, scope)
  if (b.modern) return { sql: `select case when u.office=1 then u.cand else concat_ws('/',u.state,case when u.office in (11,12,13) then u.city end,u.cand) end cand,max(u.state) state,max(u.cand) number,max(c.name) name,max(c.short_name) short_name,max(c.party) party,
    sum(u.votes) votes,sum(sum(u.votes)) over () total from ${b.res} u left join cands c on c.election=u.election and c.turn=u.turn
    and c.office=u.office and c.n=u.cand and c.uf=case when u.office=1 then 'br' else u.state end
    where ${b.filter} group by 1 order by votes desc,cand`, params: b.params }
  return { sql: `with ${b.cte} select v.candidate_id cand,max(v.state) state,max(v.number) number,max(c.name) name,max(c.short_name) short_name,
    case when count(distinct c.party)=1 then min(c.party) end party,sum(v.votes) votes,sum(sum(v.votes)) over () total
    from v left join election_candidates c on c.election_id=v.election_id and c.candidate_id=v.candidate_id and c.state=v.state
    where v.kind='candidate' group by v.candidate_id order by votes desc,cand`, params: b.params }
}

export function unitsSql(key, officeKey, grain = 'state', scope = {}) {
  const b = base(key, officeKey, scope)
  const g = grain === 'uf' ? 'state' : grain === 'mun' ? 'municipality' : grain
  const fields = ['state', ...(['municipality','zone','section'].includes(g) ? ['city_code'] : []), ...(['zone','section'].includes(g) ? ['zone'] : []), ...(g === 'section' ? ['section'] : [])]
  if (b.modern) {
    const cols = fields.map((f) => f === 'city_code' ? 'u.city' : `u.${f}`)
    return { sql: `with a as (select ${cols.map((f, i) => `${f} ${fields[i]}`).join(',')},case when u.office=1 then u.cand else concat_ws('/',u.state,case when u.office in (11,12,13) then u.city end,u.cand) end cand,u.cand number,max(c.short_name) cname,max(c.party) party,sum(u.votes) votes
      from ${b.res} u left join cands c on c.election=u.election and c.turn=u.turn and c.office=u.office and c.n=u.cand
      and c.uf=case when u.office=1 then 'br' else u.state end where ${b.filter} group by ${cols.join(',')},${fields.length + 1},u.cand)
      select *,concat_ws('/',${fields.join(',')}) id,${g === 'state' ? 'state' : 'city_code'} name,
      sum(votes) over (partition by ${fields.join(',')}) valid,row_number() over (partition by ${fields.join(',')} order by votes desc,cand) rn
      from a order by id,rn`, params: b.params }
  }
  return { sql: `with ${b.cte}, a as (select ${fields.map((f) => `v.${f}`).join(',')},v.candidate_id cand,max(v.number) number,
    max(c.short_name) cname,case when count(distinct c.party)=1 then min(c.party) end party,sum(v.votes) votes
    from v left join election_candidates c on c.election_id=v.election_id and c.candidate_id=v.candidate_id and c.state=v.state
    where v.kind='candidate' group by ${fields.map((f) => `v.${f}`).join(',')},v.candidate_id),
    t as (select ${fields.join(',')},${completeSum('valid')} reported_valid,${completeSum('blank')} blank,${completeSum('null_votes')} nul,
      ${completeSum('ballots')} ballots,${completeSum('eligible')} eligible,${completeSum('present')} present,${completeSum('absent')} absent,
      ${completeSum('sections')} sections from u group by ${fields.join(',')})
    select a.*,concat_ws('/',${fields.map((f) => `a.${f}`).join(',')}) id,${g === 'state' ? 'a.state' : 'a.city_code'} name,
      sum(votes) over (partition by ${fields.map((f) => `a.${f}`).join(',')}) valid,
      row_number() over (partition by ${fields.map((f) => `a.${f}`).join(',')} order by votes desc,cand) rn,
      t.blank,t.nul,t.ballots,t.eligible,t.present,t.absent,t.sections
    from a left join t using (${fields.join(',')}) order by id,rn`, params: b.params }
}

export function provenanceSql(key, officeKey, scope = {}) {
  const b = base(key, officeKey, scope, 'units')
  return b.modern
    ? { sql: 'select null::text source_url where false', params: [] }
    : { sql: `with ${b.cte} select distinct source_url,source_sha256,grain from u order by source_url`, params: b.params }
}

export function voteGrainsSql(key, officeKey, scope = {}) {
  const b = base(key, officeKey, scope)
  return b.modern
    ? { sql: "select 'section'::text grain", params: [] }
    : { sql: `with ${b.cte} select grain,count(*) rows from v group by grain order by grain`, params: b.params }
}
