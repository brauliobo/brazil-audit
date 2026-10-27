// These are source declarations and source-context links, not recalculated election results.
import { ELECTIONS,selectedOffice } from './model'
import { tables,ensure } from './data'
import { NOMINATION_TABLES } from './nomination-contract'
export { NOMINATION_TABLES,NOMINATION_COLUMNS,NOMINATION_NAMES,NOMINATION_FIELDS } from './nomination-contract'

export function nominationFactsQuery(table,{sourceYears,eventIds,officeKey,key,turn=null,state='',city=''}) {
  if(!NOMINATION_TABLES.includes(table))throw new Error('Unknown nomination source table') // i18n-ignore
  const params=[sourceYears,eventIds,officeKey,turn,key],filters=[
    `(election_id=any($2::text[]) or (election_id is null and source_year=any($1::int[]) and session_keys ? $5::text and ($4::int is null or turn is null or turn=$4)))`,
    `(office_key=$3 or office_key is null)`,
  ]
  if(state)filters.push(`(state=$${params.push(state)} or state is null or constituency_grain='national')`)
  if(city)filters.push(`(constituency=$${params.push(city)} or constituency_grain in ('national','state') or constituency is null)`)
  return {sql:`select * from ${table} where ${filters.join(' and ')} order by source_year,state,constituency,office_key,source_record_id`,params}
}

export function nominationSelection(key,officeKey,scope={}) {
  const cfg=ELECTIONS[key]
  return {key:cfg.sourceSession.key,sourceYears:cfg.sourceSession.sourceYears,eventIds:cfg.sourceSession.eventIds,officeKey:selectedOffice(key,officeKey).key,
    turn:cfg.turn,state:scope.state??'',city:scope.city_code??''}
}

export function nominationPartIds(table,selection) {
  return Object.entries(tables()[table].parts).filter(([,p])=>p.sourceYears.some(y=>selection.sourceYears.includes(y))
    && (!p.sessionKeys.length||p.sessionKeys.includes(selection.key))
    && (!p.officeKeys.length||p.officeKeys.includes(selection.officeKey))
    && (!selection.state||!p.states.length||p.states.includes(selection.state)||p.states.includes('br'))).map(([id])=>id)
}

export async function ensureNominations(table,selection) {
  await ensure(table,nominationPartIds(table,selection))
}

