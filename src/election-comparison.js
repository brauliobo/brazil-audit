// Comparisons use source definitions and explicit denominators, independently of collector availability.
import { METRICS } from './comparison.js'

export const NATIVE_METRICS = {
  abstention_rate: ['absent','installed'], attendance_rate: ['present','installed'], absent:['absent'], present:['present'],
  electorate:['installed'], registered_electorate:['eligible'], not_installed:['not_installed'], nominal_votes:['nominal'],
  blank_votes:['blank'], null_votes:['nul'], ballot_votes:['ballots'], blank_rate:['blank','ballots'], null_rate:['nul','ballots'],
  historical_valid:['valid'], historical_sections:['sections'], null_total_votes:['null_total'], technical_null_votes:['null_technical'],
  annulled_votes:['annulled'], subjudice_votes:['annulled_subjudice'], separate_votes:['annulled_separate'],
}
const additions = ['historical_valid','historical_sections','null_total_votes','technical_null_votes','annulled_votes','subjudice_votes','separate_votes','candidate_total_votes']
export const ELECTION_COMPARISON_METRICS = [...METRICS,...additions.map((id) => ({id,family:'results',source:id==='candidate_total_votes'?'competition':'results',rate:false}))]
export const comparisonMetric = (id) => ELECTION_COMPARISON_METRICS.find((m) => m.id===id)
export const needsCandidate = (id) => ['candidate_votes','candidate_share','candidate_rank','party_votes','party_share'].includes(id)

export function nativeComparisonQuery(id, request) {
  const [field,denominator] = NATIVE_METRICS[id]
  return {sql:`select ${field}::float8 numerator,${denominator ? denominator+'::float8' : 'null::float8'} denominator,
    units records,grain,${field==='nominal' ? 'nominal_kind' : "'source_quantity'::text"} count_meaning from (${request.sql}) source_totals`,params:request.params}
}

export function candidateComparisonQuery(id, request, target='') {
  const params=[...request.params,target],pick=`$${params.length}`
  const party=id.startsWith('party_')
  const chosen=`case when ${pick}::text='' then rn=1 else candidate=${pick} end` // i18n-ignore
  const numerator={candidate_votes:`sum(votes) filter(where ${chosen})`,candidate_share:`sum(votes) filter(where ${chosen})`,
    candidate_rank:`max(rn) filter(where ${chosen})`,winner_rate:'max(votes)',lead_margin:'max(votes) filter(where rn=1)-coalesce(max(votes) filter(where rn=2),0)',
    effective_candidates:'power(sum(votes),2)/nullif(sum(power(votes,2)),0)',candidate_hhi:'sum(power(votes,2))/nullif(power(sum(votes),2),0)',
    candidate_count:'case when count(*)>0 then count(*) end',party_votes:`sum(votes) filter(where ${chosen})`,party_share:`sum(votes) filter(where ${chosen})`,
    party_count:"case when count(*) filter(where candidate='__unknown_party__')=0 and count(*)>0 then count(*) end",candidate_total_votes:'sum(votes)'}[id]
  if(!numerator)throw new Error('Unsupported competition metric') // i18n-ignore
  const rate=['candidate_share','winner_rate','lead_margin','party_share'].includes(id)
  return {sql:`with source_candidates as (${request.sql}), grouped as (
    select ${party ? "coalesce(party_label,'__unknown_party__')" : 'cand'} candidate,
      max(${party ? 'party_label' : 'coalesce(short_name,name,number)'}) label,sum(votes)::float8 votes,
      case when count(distinct count_meaning)=1 then min(count_meaning) else 'mixed' end count_meaning
    from source_candidates where votes is not null group by 1), ranked as (select *,row_number() over(order by votes desc,candidate) rn from grouped)
    select ${numerator}::float8 numerator,${rate ? 'sum(votes)' : 'null'}::float8 denominator,count(*) records,
      max(coalesce(label,candidate)) filter(where ${chosen}) target,
      case when count(distinct count_meaning)=1 then min(count_meaning) else 'mixed' end count_meaning from ranked`,params}
}

export function comparisonValue(definition,row) {
  if(!row || !Number(row.records) || row.numerator==null)return null
  return definition.rate ? Number(row.denominator)>0 ? Number(row.numerator)/Number(row.denominator) : null : Number(row.numerator)
}

export function comparisonChanges(rows) {
  const bases=new Map()
  return rows.map((row) => {
    if(row.value==null || !row.comparability)return {...row,change:null}
    if(!bases.has(row.comparability))bases.set(row.comparability,row.value)
    return {...row,change:row.value-bases.get(row.comparability)}
  })
}
