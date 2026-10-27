// Official anonymous demographic cells are snapshots, not candidate or voter-level links.
export const PROFILE_AXES = ['gender','marital_status','age','education','race','gender_identity','quilombola','libras','indigenous_language','indigenous_group','quilombola_language','biometric_status','vote_obligation']
const axisFields = (axis) => axis === 'vote_obligation' ? { code: 'vote_obligation', label: 'vote_obligation' } : { code: `${axis}_code`, label: axis }
export const PROFILE_METRICS = ['eligible','present','absent','biometric','disability','social_name','present_disability','absent_disability','present_transfer','absent_transfer','present_optional','absent_optional','present_mandatory','absent_mandatory','present_disability_optional','absent_disability_optional','present_disability_mandatory','absent_disability_mandatory']

function predicate(scope) {
  const params = [], filters = []
  const add = (value) => { params.push(value); return `$${params.length}` }
  for (const key of ['dataset_id','year','level','state','city_code','zone']) {
    if (scope[key] == null || scope[key] === '') continue
    filters.push(`${key} = ${add(scope[key])}`)
  }
  filters.push(`turn is not distinct from ${add(scope.turn ?? null)}::int`)
  for (const [axis, value] of Object.entries(scope.filters ?? {})) {
    if (!PROFILE_AXES.includes(axis)) throw new Error('Unknown demographic axis') // i18n-ignore
    if (value !== '' && value != null) filters.push(`${axisFields(axis).code} is not distinct from ${add(value)}`)
  }
  return { where: filters.join(' and '), params }
}

export function profileBreakdownQuery(scope, axis, metric) {
  if (!PROFILE_AXES.includes(axis) || !PROFILE_METRICS.includes(metric)) throw new Error('Unknown demographic field') // i18n-ignore
  const { where, params } = predicate(scope)
  const fields = axisFields(axis)
  return { sql: `select ${fields.code} code,${fields.label} label,
    case when count(${metric})=count(*) then sum(${metric}) end value,
    sum(${metric}) known_value,count(${metric}) known_cells,count(*) cells,
    array_agg(distinct source_url) source_urls,array_agg(distinct source_sha256) source_hashes
    from election_profiles where ${where} group by ${fields.code},${fields.label} order by ${fields.code} nulls last,${fields.label}`, params } // i18n-ignore
}

export function profileOptionsQuery(scope, axis) {
  if (!PROFILE_AXES.includes(axis)) throw new Error('Unknown demographic axis') // i18n-ignore
  const { where, params } = predicate(scope)
  const fields = axisFields(axis)
  return { sql: `select distinct ${fields.code} code,${fields.label} label from election_profiles where ${where} order by code nulls last,label`, params }
}

export function profilePlacesQuery(scope) {
  const { where, params } = predicate({ ...scope, city_code: '', zone: '', filters: {} })
  return { sql: `select distinct city_code,city_name,zone from election_profiles where ${where} order by city_name,zone`, params }
}
