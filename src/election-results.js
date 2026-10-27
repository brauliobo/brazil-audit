// Source facts share a query contract; section data retain their actual grain.
import { ELECTIONS } from './model'
import { ensure, ensureSmall, ensureState, parts, tables } from './data'
import { rollup } from './results'
import { ELECTIONS as NATIVE_ELECTIONS } from './elections'
import FACT_REGISTRY from '../data/elections.json'
import SOURCE_BINDINGS from '../data/election-source-bindings.json'

const keyOf = (key, requested) => {
  const cfg = ELECTIONS[key]
  const definitions = cfg.officeDefinitions ?? cfg.sourceSession?.offices ?? []
  const selected = definitions.find((o) => o.key === requested || String(o.id) === String(requested)) ?? definitions[0]
  const numbers = { president: 1, governor: 3, senator: 5, federal_deputy: 6, state_deputy: 7, district_deputy: 8, mayor: 11, councillor: 13 }
  return { cfg, definition: selected, jurisdiction: selected?.constituencyGrain, office: selected?.id ?? numbers[requested] ?? requested ?? cfg.offices[0], officeKey: selected?.key ?? requested }
}
const nativeOffice = (cfg,office) => Boolean(cfg.legacyKey && NATIVE_ELECTIONS[cfg.legacyKey]?.offices.includes(Number(office)))
const historical = (cfg) => Boolean(cfg.sourceSession && !cfg.legacyKey)
const factualConfig = (cfg,office) => nativeOffice(cfg,office) ? cfg : { ...cfg,legacyKey:null }
const idsOf = (cfg) => cfg.sourceSession.eventIds
const scopeGrain = (scope) => scope.section ? 'section' : scope.zone ? 'zone' : scope.city_code ? 'municipality' : 'state'
const localOffice = (office) => ['11','12','13','25'].includes(String(office))
const voteTableOf = (office, grain) => grain === 'section' ? 'election_section_votes'
  : grain === 'state' || grain === 'uf' || (localOffice(office) && ['municipality','mun'].includes(grain)) ? 'election_vote_rollups' : 'election_votes'
const selectedParts = (table, cfg, officeKey, scope = {}) => Object.entries(tables()[table].parts).filter(([,p]) =>
  p.electionIds.some((id) => cfg.sourceSession.eventIds.includes(id)) && p.officeKeys.includes(officeKey)
  && p.sourceYears.some((year) => cfg.sourceSession.sourceYears.includes(year)) && (!scope.state || p.states.includes(scope.state))
  && (!scope.city_code || !p.cities?.length || p.cities.includes(scope.city_code))).map(([id]) => id)


export async function ensureTotals(key,officeKey,scope={}) {
  const {cfg,definition,officeKey:canonical}=keyOf(key,officeKey)
  if (cfg.sourceSession) {
    await Promise.all([
      ensure('election_units', Object.entries(tables().election_units.parts).filter(([,p]) => p.electionIds.some((id) => cfg.sourceSession.eventIds.includes(id)) && p.officeKeys.includes(canonical) && (!scope.state || p.state === scope.state)).map(([id]) => id)),
    ])
  }
  if(cfg.legacyKey&&scope.city_code)await ensure('mun_map')
  const reference=definition?.capabilities?.sources?.sectionReference
  if(reference) {
    const summary=definition.capabilities.unitStates??[]
    const fine=scope.grain && !['state','all'].includes(scope.grain)
    const missing=selectedParts('election_section_units',cfg,canonical,scope).filter(id=>fine || tables().election_section_units.parts[id].states.some(s=>!summary.includes(s)))
    await ensure('election_section_units',missing)
  }
 }

export async function ensureElection(key, officeKey, scope = {}) {
  const { cfg, office, definition, jurisdiction, officeKey: canonical } = keyOf(key, officeKey)
  await Promise.all([ensureTotals(key,canonical,scope),ensure('election_places',Object.entries(tables().election_places.parts).filter(([,p])=>p.sessionKeys.includes(cfg.sourceSession.key)&&(!scope.state||p.states.includes(scope.state))).map(([id])=>id))])
  if (!nativeOffice(cfg,office)) {
    const table = definition?.capabilities?.sources?.observedSections && !definition?.capabilities?.sources?.votes ? 'election_section_votes' : voteTableOf(jurisdiction==='municipality' ? 11 : office, scope.grain ?? scopeGrain(scope))
    const roster = definition?.capabilities?.candidateAttributes ? 'candidate_attributes' : 'election_candidates'
    await Promise.all([
      ensure(table,selectedParts(table,cfg,canonical,scope)),
      ensure(roster,selectedParts(roster,cfg,canonical,jurisdiction==='national' ? { ...scope,state:'',city_code:'' } : scope)),
      ensure('candidate_identity',selectedParts('candidate_identity',cfg,canonical,scope)),
    ])
  } else {
    await Promise.all([ensure('cands'), ensure('mun_map'), ensureRoster(key,canonical,scope)])
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
    const value = add(scope[field])
    if (field === 'city_code' && (!historical(cfg) || cfg.legacyCityNames)) {
      const column = historical(cfg) ? 'city_code' : 'city'
      const mapped = historical(cfg) ? 'tse' : 'city', original = historical(cfg) ? 'city' : 'tse'
      filters.push(`(${alias}.${column} = ${value} or ${alias}.${column} = (select ${mapped} from mun_map where state=${alias}.state and ${original}=${value}))`)
    } else filters.push(`${alias}.${field} = ${value}`)
  }
  return filters.join(' and ')
}

function base(key, officeKey, scope = {}, source = 'votes', grain = null) {
  grain ??= scopeGrain(scope)
  const selected = keyOf(key, officeKey)
  if (source === 'units' && !selected.cfg.sourceSession) throw new Error('Election source profile is not installed') // i18n-ignore
  const { office, officeKey: canonical } = selected
  const cfg = source === 'units' && selected.cfg.sourceSession ? { ...selected.cfg, legacyKey: null, legacyCityNames: Boolean(selected.cfg.legacyKey) } : factualConfig(selected.cfg,office)
  const params = []
  const filter = where(cfg, office, canonical, scope, 'u', params)
  if (!historical(cfg)) {
    const city = scope.city_code ? ` and city = $${params.indexOf(scope.city_code) + 1}` : ''
    return { cfg, params, office, filter, modern: true, city, res: scope.zone || scope.section ? 'cs' : rollup(cfg.legacyKey ?? key).res, tot: scope.zone || scope.section ? 'sec' : rollup(cfg.legacyKey ?? key).tot }
  }
  // Official national/state/municipality rollups are not additive to their descendants.
  const reference=selected.definition?.capabilities?.sources?.sectionReference
  const unitColumns=['election_id','office_key','state','city_code','zone','section','grain','transit','nominal','legend','sections','valid','blank','null_votes','ballots','eligible','installed','present','absent','not_installed','null_total','null_technical','annulled','annulled_subjudice','annulled_separate','source_url','source_sha256']
  const summaryFilter=filter.replaceAll('u.','summary.')
  const finer=grain==='all'||grain==='state'||grain==='uf' ? '' : grain==='municipality'||grain==='mun' ? ' and summary.city_code is not null' : grain==='zone' ? ' and summary.zone is not null' : ' and summary.section is not null'
  const referenceColumns=unitColumns.join(',')
  const unitTable=reference ? `(select ${referenceColumns} from election_units union all select ${referenceColumns} from election_section_units reference where not exists (
    select 1 from election_units summary where ${summaryFilter}${finer} and summary.state=reference.state))` : 'election_units'
  const units = `select * from (select u.*,
      bool_or(grain='national') over (partition by election_id,office_key) _has_national,
      bool_or(grain='state') over (partition by election_id,office_key,state) _has_state,
      bool_or(grain='municipality') over (partition by election_id,office_key,state,city_code) _has_city,
      bool_or(grain='zone') over (partition by election_id,office_key,state,city_code,zone) _has_zone
    from ${unitTable} u where ${filter} and coalesce(u.transit,'N') <> 'S'${source === 'units' && grain !== 'all' ? ` and ${grain === 'state' || grain === 'uf' ? "u.grain <> 'national'" : grain === 'municipality' || grain === 'mun' ? "u.city_code is not null" : grain === 'zone' ? "u.zone is not null" : "u.section is not null"}` : ''}) scoped
    where grain='national' or (not _has_national and
      (grain='state' or (not _has_state and (grain='municipality' or
        (not _has_city and (grain='zone' or not _has_zone))))))`
  const voteTable = selected.definition?.capabilities?.sources?.observedSections && !selected.definition?.capabilities?.sources?.votes ? 'election_section_votes' : voteTableOf(selected.jurisdiction==='municipality' ? 11 : office, grain)
  return { cfg, params, office, modern: false, unitSourceSql: units, voteTable, cte: source==='units' ? `u as (${units})` : `u as (${units}), v as (select v.* from ${voteTable} v
    where ${filter.replaceAll('u.', 'v.')} and coalesce(v.transit,'N') <> 'S')` }
}
const completeSum = (column, alias = '') => `case when count(${alias}${column})=count(*) then sum(${alias}${column}) end`

export function totalsSql(key, officeKey, scope = {}) {
  const b = base(key, officeKey, scope, 'units', 'all')
  return { sql: `with ${b.cte} select ${completeSum('sections')} sections,
    'official_nominal_valid'::text nominal_kind,${completeSum('nominal')} nominal,${completeSum('valid')} valid,
    ${completeSum('legend')} legend,${completeSum('blank')} blank,${completeSum('null_votes')} nul,
    ${['ballots','eligible','installed','present','absent','not_installed','null_total','null_technical','annulled','annulled_subjudice','annulled_separate'].map((f) => `${completeSum(f)} ${f}`).join(',')},
    count(*) units,string_agg(distinct grain,',') grain from u`, params: b.params }
}

const identityBridge = () => {
  const rows=SOURCE_BINDINGS.flatMap((b) => (b.candidateIdentityLinks ?? []).map((r) => [b.sourceEventId,r.sourceCandidateId,b.targetEventId,r.targetCandidateId]))
  const quoted=(v) => "'"+v.replaceAll("'","''")+"'"
  return rows.length ? `(values ${rows.map((r)=>'('+r.map(quoted).join(',')+')').join(',')})` : `(select null::text,null::text,null::text,null::text where false)`
}

const observedOptions = (selected) => {
  const rows=(FACT_REGISTRY.observedBallotOptions??[]).filter(r=>idsOf(selected.cfg).includes(r.election_id)&&r.office_key===selected.officeKey)
  const quote=v=>v==null?'null':"'"+String(v).replaceAll("'","''")+"'"
  const values=rows.map(r=>[r.election_id,r.state,r.constituency,r.candidate_id,r.number,r.names.join(' / '),r.source_url,r.source_sha256].map(quote).join(','))
  return values.length?`(values ${values.map(r=>'('+r+')').join(',')})`:`(select null::text,null::text,null::text,null::text,null::text,null::text,null::text,null::text where false)`
}

export function candidatesSql(key, officeKey, scope = {}, paging = {}) {
  const b = base(key, officeKey, scope)
  if (b.modern) return { sql: `select case when u.office=1 then u.cand else concat_ws('/',u.state,case when u.office in (11,12,13,25) then u.city end,u.cand) end cand,case when max(u.office)=1 then 'br' else max(u.state) end state,max(u.cand) number,max(c.name) name,max(c.short_name) short_name,max(c.party) party,null::text party_name,max(c.party) party_label,count(*) over () total_rows,
    'observed_cast'::text count_meaning,sum(u.votes) votes,sum(sum(u.votes)) over () candidate_total from ${b.res} u left join cands c on c.election=u.election and c.turn=u.turn
    and c.office=u.office and c.n=u.cand and c.uf=case when u.office=1 then 'br' else u.state end
    where ${b.filter} group by 1 order by votes desc nulls last,cand${paging.limit == null ? '' : ` limit $${b.params.length + 1} offset $${b.params.length + 2}`}`, params: paging.limit == null ? b.params : [...b.params,paging.limit,paging.offset ?? 0] }
  const selection = keyOf(key, officeKey)
  const roster = selection.definition?.capabilities?.candidateAttributes ? 'candidate_attributes' : 'election_candidates'
  if(selection.definition?.capabilities?.sources?.observedSections&&!selection.definition?.capabilities?.sources?.votes) {
    const options=observedOptions(selection)
    return {sql:`with ${b.cte}, options(election_id,state,constituency,candidate_id,number,name,source_url,source_sha256) as ${options}
      select v.candidate_id cand,v.state,v.constituency,v.constituency city_code,max(p.city_name) city_name,max(v.number) number,max(o.name) name,max(o.name) short_name,
        null::text party,null::text party_name,null::text party_label,sum(v.votes) votes,sum(sum(v.votes)) over() candidate_total,
        'observed_cast'::text count_meaning,'observed_ballot_option'::text identity_status,count(*) vote_record_count,count(*) over() total_rows
      from v left join options o on o.election_id=v.election_id and o.state=v.state and o.candidate_id=v.candidate_id
      left join election_places p on p.session_key=$${b.params.length+1} and p.state=v.state and p.city_code=v.constituency
      where v.kind='candidate' group by v.candidate_id,v.state,v.constituency order by votes desc,cand${paging.limit==null?'':` limit $${b.params.length+2} offset $${b.params.length+3}`}`,
      params:[...b.params,selection.cfg.sourceSession.key,...(paging.limit==null?[]:[paging.limit,paging.offset??0])]}
  }

  const params = [...b.params], add = (v) => { params.push(v);return `$${params.length}` }
  const filters = [`r.election_id=any(${add(idsOf(b.cfg))}::text[])`,`r.office_key=${add(selection.officeKey)}`,`r.candidate_id not like 'party_list:%'`]
  if (scope.state && selection.jurisdiction !== 'national') filters.push(`r.state=${add(scope.state)}`)
  if (scope.city_code && selection.jurisdiction === 'municipality') filters.push(`r.constituency=${add(scope.city_code)}`)
  const session = add(b.cfg.sourceSession.key)
  const meaning = `case when v.grain='section' then 'observed_cast' when v.destination='valid' then 'official_nominal_valid' else 'reported_nominal' end`
  return { sql: `with ${b.cte}, counts as (select election_id,candidate_id,sum(votes) votes,count(*) vote_record_count,
      string_agg(distinct ${meaning},',') count_meaning from v where kind='candidate' group by election_id,candidate_id),
    nominees as (select r.election_id,r.candidate_id cand,max(r.number) number,string_agg(distinct r.name,' / ') name,
      string_agg(distinct r.short_name,' / ') short_name,case when count(distinct r.party)=1 then min(r.party) end party,case when count(distinct r.party_name)=1 then min(r.party_name) end party_name,
      max(r.constituency) constituency,${selection.jurisdiction === 'national' ? "'br'::text" : 'max(r.state)'} state,
      case when count(distinct r.status)=1 then min(r.status) end status,array_agg(distinct r.status) status_variants,
      array_agg(distinct r.source_url) source_urls from ${roster} r where ${filters.join(' and ')} group by r.election_id,r.candidate_id)
    select n.election_id,n.number,n.name,n.short_name,n.party,n.party_name,n.constituency,n.state,n.status,n.status_variants,n.source_urls,coalesce(bridge.target_id,n.cand) cand,n.cand source_record_candidate_id,coalesce(n.party,n.party_name) party_label,count(*) over () total_rows,v.votes,v.vote_record_count,v.count_meaning,sum(v.votes) over () candidate_total,
      ${selection.jurisdiction === 'municipality' ? 'p.city_code,p.city_name' : 'null::text city_code,null::text city_name'},
      case when n.cand like 'record:%' then ci.identity_status else 'context_resolved' end identity_status,ci.source_record_id
    from nominees n left join ${identityBridge()} bridge(source_event,source_id,target_event,target_id) on bridge.source_event=n.election_id and bridge.source_id=n.cand
    left join counts v on v.election_id=coalesce(bridge.target_event,n.election_id) and v.candidate_id=coalesce(bridge.target_id,n.cand)
    left join election_places p on p.session_key=${session} and p.state=n.state and p.city_code=n.constituency
    left join candidate_identity ci on ci.election_id=n.election_id and ci.candidate_id=n.cand
    order by votes desc nulls last,n.cand${paging.limit == null ? '' : ` limit $${params.length + 1} offset $${params.length + 2}`}`,params:paging.limit == null ? params : [...params,paging.limit,paging.offset ?? 0] }

}

export function unitsSql(key, officeKey, grain = 'state', scope = {}) {
  const requestedGrain = grain === 'uf' ? 'state' : grain === 'mun' ? 'municipality' : grain
  const local = keyOf(key, officeKey).jurisdiction === 'municipality'
  const g = local && requestedGrain === 'state' ? 'municipality' : requestedGrain
  const b = base(key, officeKey, scope, 'votes', g)
  const observed = base(key, officeKey, scope, 'units', g)
  const options=observedOptions(keyOf(key,officeKey))
  const fields = ['state', ...(['municipality','zone','section'].includes(g) ? ['city_code'] : []), ...(['zone','section'].includes(g) ? ['zone'] : []), ...(g === 'section' ? ['section'] : [])]
  const vote = b.modern
    ? `select u.state,m.tse city_code,u.city city_name,${b.res === 'cs' ? 'u.zone,u.section' : 'null::text zone,null::text section' /* i18n-ignore */},
        case when u.office=1 then u.cand else concat_ws('/',u.state,case when u.office in (11,12,13,25) then u.city end,u.cand) end cand,
        u.cand number,coalesce(c.short_name,c.name) cname,c.party,null::text party_name,c.party party_label,'observed_cast'::text count_meaning,u.votes from ${b.res} u left join cands c on c.election=u.election and c.turn=u.turn
        and c.office=u.office and c.n=u.cand and c.uf=case when u.office=1 then 'br' else u.state end left join mun_map m on m.state=u.state and m.city=u.city where ${b.filter}`
    : `select v.state,v.city_code,p.city_name,v.zone,v.section,v.candidate_id cand,v.number,coalesce(c.short_name,c.name,o.name) cname,c.party,c.party_name,coalesce(c.party,c.party_name) party_label,case when v.grain='section' then 'observed_cast' when v.destination='valid' then 'official_nominal_valid' else 'reported_nominal' end count_meaning,v.votes
        from ${b.voteTable} v left join ${options} o(election_id,state,constituency,candidate_id,number,name,source_url,source_sha256) on o.election_id=v.election_id and o.state=v.state and o.candidate_id=v.candidate_id left join election_candidates c on c.election_id=v.election_id and c.candidate_id=v.candidate_id and c.state=v.state left join election_places p on p.session_key=$${b.params.length + 1} and p.state=v.state and p.city_code=v.city_code
        where ${where(b.cfg, b.office, keyOf(key, officeKey).officeKey, scope, 'v', [])} and coalesce(v.transit,'N') <> 'S' and v.kind='candidate'`
  if (!b.modern) b.params.push(b.cfg.sourceSession.key)
  const unitSource = observed.unitSourceSql.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + b.params.length}`)
  return { sql: `with u as (${unitSource}), v as (${vote}),
    a as (select ${fields.join(',')},cand,max(city_name) city_name,max(number) number,max(cname) cname,
      case when count(distinct party)=1 then min(party) end party,case when count(distinct party_name)=1 then min(party_name) end party_name,case when count(distinct party_label)=1 then min(party_label) end party_label,string_agg(distinct count_meaning,',') count_meaning,sum(votes) votes from v where ${fields.map((f) => `${f} is not null`).join(' and ')} group by ${fields.join(',')},cand),
    t as (select ${fields.join(',')},string_agg(distinct grain,',') source_grains,count(*) source_units,${['nominal','valid','blank','null_votes','ballots','eligible','installed','present','absent','sections'].map((f) => `${completeSum(f)} ${f}`).join(',')}
      from u group by ${fields.join(',')})
    select a.*,'${g}'::text grain,concat_ws('/',${fields.map((f) => `a.${f}`).join(',')}) id,${g === 'state' ? 'a.state' : 'coalesce(a.city_name,a.city_code)'} name,
      sum(votes) over (partition by ${fields.map((f) => `a.${f}`).join(',')}) candidate_total,
      row_number() over (partition by ${fields.map((f) => `a.${f}`).join(',')} order by votes desc,cand) rn,
      t.source_grains,t.source_units,t.nominal nominal_valid,case when a.count_meaning='observed_cast' then sum(votes) over (partition by ${fields.map((f) => `a.${f}`).join(',')}) end nominal_registered,t.valid,t.blank,t.null_votes nul,t.ballots,t.eligible,t.installed,t.present,t.absent,t.sections
    from a left join t using (${fields.join(',')}) order by id,rn`, params: [...b.params, ...observed.params] }
}

export function provenanceSql(key, officeKey, scope = {}) {
  const b=base(key,officeKey,scope,'units','all'),roster=rosterSql(key,officeKey,scope)
  const shifted=roster.sql.replace(/\$(\d+)/g,(_,n)=>`$${Number(n)+b.params.length}`)
  const votes=base(key,officeKey,scope)
  const voteSources=votes.modern ? '' : ` union select source_url,source_sha256,grain,'candidate-results'::text role from ${votes.voteTable} v where ${where(votes.cfg,votes.office,keyOf(key,officeKey).officeKey,scope,'v',[]).replace(/\$(\d+)/g,(_,n)=>`$${Number(n)+b.params.length+roster.params.length}`)}`
  return {sql:`with ${b.cte}, roster as (${shifted}) select distinct source_url,source_sha256,grain,role from (
    select source_url,source_sha256,grain,'population-reference'::text role from u
    union select source_url,source_sha256,null::text grain,'candidate-registration'::text role from roster${voteSources}
    ) sources where source_url is not null order by source_url,role`,params:[...b.params,...roster.params,...(votes.modern?[]:votes.params)]}
}

export function voteGrainsSql(key, officeKey, scope = {}) {
  const b = base(key, officeKey, scope)
  return b.modern
    ? { sql: "select 'section'::text grain", params: [] }
    : { sql: `with ${b.cte} select grain,count(*) rows from v group by grain order by grain`, params: b.params }
}

export function availableVoteGrains(key, officeKey) {
  const { cfg, officeKey: canonical } = keyOf(key, officeKey)
  const definition = cfg.officeDefinitions?.find((o) => o.key === canonical)
  return definition?.capabilities?.voteGrains ?? definition?.capabilities?.grains ?? []
}

export function analysisPartBytes(key,officeKey,scope={}) {
  const {cfg,office,officeKey:canonical}=keyOf(key,officeKey)
  const output={}
  for(const grain of availableVoteGrains(key,officeKey)) {
    const table=voteTableOf(office,grain)
    output[grain]=selectedParts(table,cfg,canonical,scope).reduce((n,id)=>n+tables()[table].parts[id].bytes,0)
  }
  return output
}

export function placesSql(key, officeKey, scope = {}) {
  const cfg=ELECTIONS[key],params=[cfg.sourceSession.key]
  const state=scope.state ? ` and state=$${params.push(scope.state)}` : ''
  return { sql: `select state,city_code,city_name from election_places where session_key=$1${state} order by city_name,city_code`,params }
}

// These are the reported TSE outcome labels, not recalculated seat-allocation rules.
// i18n-ignore
export const ELECTED_SOURCE_LABELS = ['ELEITO','ELEITO POR QE','ELEITO POR QP','ELEITO 1º TURNO QE','ELEITO 1º TURNO QP','ELEITO 2º TURNO'] // i18n-ignore
// i18n-ignore
const OTHER_OUTCOME_LABELS = ['NÃO ELEITO','SUPLENTE','2º TURNO','REGISTRO NEGADO ANTES DA ELEIÇÃO','REGISTRO NEGADO APÓS ELEIÇÃO'] // i18n-ignore

export async function ensureRoster(key, officeKey, scope = {}) {
  const selected = keyOf(key,officeKey)
  const table = selected.definition.capabilities.candidateAttributes ? 'candidate_attributes' : 'election_candidates'
  const rosterScope = selected.jurisdiction === 'national' ? { ...scope,state:'',city_code:'' } : scope
  await Promise.all([
    ensure(table,selectedParts(table,selected.cfg,selected.officeKey,rosterScope)),
    ensure('candidate_identity',selectedParts('candidate_identity',selected.cfg,selected.officeKey,scope)),
    ensure('election_places',Object.entries(tables().election_places.parts).filter(([,p]) => p.sessionKeys.includes(selected.cfg.sourceSession.key) && (!scope.state || p.states.includes(scope.state))).map(([id]) => id)),
  ])
}

export function rosterSql(key, officeKey, scope = {}) {
  const selected=keyOf(key,officeKey), attributes=Boolean(selected.definition.capabilities.candidateAttributes)
  const table=attributes ? 'candidate_attributes' : 'election_candidates'
  const stage=selected.definition.electionStage
  if (!stage) throw new Error('Election stage is not declared by the source registry') // i18n-ignore
  const params=[idsOf(selected.cfg),selected.officeKey,selected.cfg.sourceSession.key,ELECTED_SOURCE_LABELS,OTHER_OUTCOME_LABELS,stage]
  const filters=[`r.election_id=any($1::text[])`,`r.office_key=$2`,`r.candidate_id not like 'party_list:%'`]
  if (scope.state && selected.jurisdiction !== 'national') filters.push(`r.state=$${params.push(scope.state)}`)
  if (scope.city_code && selected.jurisdiction === 'municipality') filters.push(`r.constituency=$${params.push(scope.city_code)}`)
  return {sql:`select r.election_id,r.state,r.constituency,r.candidate_id,r.number,r.name,r.short_name,r.party,r.party_name,coalesce(r.party,r.party_name) party_label,
    r.status,r.status_code,r.source_candidate_id,r.source_url,r.source_sha256,p.city_code,p.city_name,
    ${attributes ? 'r.gender,r.race,r.education,r.occupation,r.age_band,r.candidacy_status' : 'null::text gender,null::text race,null::text education,null::text occupation,null::text age_band,null::text candidacy_status'},
    case when r.candidate_id like 'record:%' then ci.identity_status else 'context_resolved' end identity_status,ci.source_record_id,
    case when upper(r.status)=any($4::text[]) then true when upper(r.status)=any($5::text[]) then false end is_elected,
    $6::text election_stage
    from ${table} r left join election_places p on p.session_key=$3 and p.state=r.state and p.city_code=r.constituency
    left join candidate_identity ci on ci.election_id=r.election_id and ci.candidate_id=r.candidate_id
    where ${filters.join(' and ')} order by r.state,p.city_name,r.name,r.candidate_id`,params}
}

export function unitMetricsSql(key, officeKey, grain='state', scope={}) {
  const fields=['state',...(['municipality','zone','section'].includes(grain)?['city_code']:[]),...(['zone','section'].includes(grain)?['zone']:[]),...(grain==='section'?['section']:[])]
  const observed=base(key,officeKey,scope,'units',grain),votes=base(key,officeKey,scope,'votes',grain)
  const params=[...votes.params,...observed.params],source=observed.unitSourceSql.replace(/\$(\d+)/g,(_,n)=>`$${Number(n)+votes.params.length}`)
  const voteSource=votes.modern ? `select u.state,u.city city_code,u.office,u.votes,'observed_cast'::text count_meaning from ${votes.res} u where ${votes.filter}`
    : `select v.*,case when grain='section' then 'observed_cast' when destination='valid' then 'official_nominal_valid' else 'reported_nominal' end count_meaning from ${votes.voteTable} v where ${where(votes.cfg,votes.office,keyOf(key,officeKey).officeKey,scope,'v',[])} and coalesce(transit,'N')<>'S' and kind='candidate'`
  return {sql:`with source_units as (${source}),source_votes as (${voteSource}),
    t as (select ${fields.join(',')},${['nominal','valid','blank','null_votes','ballots','eligible','installed','present','absent','sections'].map(f=>`${completeSum(f)} ${f}`).join(',')} from source_units group by ${fields.join(',')}),
    v as (select ${fields.join(',')},sum(votes) candidate_total,string_agg(distinct count_meaning,',') count_meaning from source_votes group by ${fields.join(',')})
    select ${fields.map(f=>`coalesce(t.${f},v.${f}) ${f}`).join(',')},concat_ws('/',${fields.map(f=>`coalesce(t.${f},v.${f})`).join(',')}) id,
      t.nominal nominal_valid,t.valid,t.blank,t.null_votes nul,t.ballots,t.eligible,t.installed,t.present,t.absent,t.sections,v.candidate_total,v.count_meaning
    from t full join v using (${fields.join(',')}) order by id`,params}
}
