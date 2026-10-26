// Metric definitions own their population, source and denominator, independently of the selected year.
const metric = (id, family, source, rate = false) => ({ id, family, source, rate })
export const METRICS = [
  ...['abstention_rate','attendance_rate','absent','present','electorate'].map((id) => metric(id, 'participation', 'participation', id.endsWith('_rate'))),
  ...['valid_votes','blank_votes','null_votes','ballot_votes','blank_rate','null_rate'].map((id) => metric(id, 'results', 'results', id.endsWith('_rate'))),
  metric('events', 'operation', 'time'), metric('late_rate', 'operation', 'time', true),
  metric('manual_rate', 'operation', 'identification', true), metric('nonbiometric_rate', 'operation', 'identification', true),
  metric('flagged_rate', 'operation', 'signals', true),
  metric('seats', 'representation', 'seats'), metric('parties', 'representation', 'seats'),
]
export const metricOf = (id) => METRICS.find((m) => m.id === id)

export function metricSource(id, election, available) {
  const { source } = metricOf(id)
  if (source === 'participation') {
    if (election.hasTurnout && available.has('turnout')) return 'turnout'
    return election.hasSignals && available.has('sgz') ? 'sgz' : null
  }
  if (source === 'results') return available.has('tot') ? (election.hasResidual ? 'totx' : 'tot') : null
  if (source === 'time') return election.hasTimes && available.has('vtc') ? 'vtc' : null
  if (source === 'identification') return election.hasTimes && election.hasSignals && available.has('sgz') ? 'sgz' : null
  if (source === 'signals') return election.hasSignals && available.has('sgz') ? 'sgz' : null
  return election.hasSeats && available.has('seats') ? 'seats' : null
}

export function metricResult(id, row) {
  const numerator = row.numerator == null ? null : Number(row.numerator)
  const denominator = row.denominator == null ? null : Number(row.denominator)
  const value = !Number(row.records) || numerator == null ? null : metricOf(id).rate ? (denominator > 0 ? numerator / denominator : null) : numerator
  return { value, numerator, denominator }
}

// Parameters: state (empty = Brazil), municipality name (empty = all), office.
export function comparisonQuery(id, election, source) {
  const where = `election = ${election.year} and turn = ${election.turn}`
  const scope = `($1::text = '' or state = $1) and ($2::text = '' or city = $2)`
  let numerator, denominator = 'null', from = source, filter = scope
  if (source === 'turnout' || ['abstention_rate','attendance_rate','absent','present','electorate'].includes(id)) {
    const official = source === 'turnout'
    const present = official ? 'present' : 'comp'
    const electorate = official ? 'installed' : 'aptos'
    numerator = id === 'electorate' ? `sum(${electorate})` : ['present','attendance_rate'].includes(id) ? `sum(${present})` : `sum(${official ? 'absent' : 'aptos - comp'})`
    denominator = `sum(${electorate})`
    if (official) filter = `scope = case when $2::text <> '' then 'city' when $1::text <> '' then 'uf' else 'br' end and state = case when $1::text = '' then 'br' else $1 end and city is not distinct from nullif($2::text, '')`
  } else if (source === 'tot' || source === 'totx') {
    const total = 'nominal + blank + nul'
    numerator = `sum(${id.startsWith('blank') ? 'blank' : id.startsWith('null') ? 'nul' : id === 'valid_votes' ? 'nominal' : total})`
    denominator = `sum(${total})`
    filter += ' and office = $3'
  } else if (source === 'vtc') {
    numerator = id === 'events' ? 'sum(n)' : `(select coalesce(sum(v), 0) from vtc x, unnest(x.b) with ordinality bins(v, ord) where x.election = ${election.year} and x.turn = ${election.turn} and ($1::text = '' or x.state = $1) and ($2::text = '' or x.city = $2) and 18000 + 600 * (ord - 1 - 6 * x.tz) >= 61200)`
    denominator = 'sum(n)'
  } else if (source === 'sgz') {
    numerator = id === 'flagged_rate' ? 'sum(flagged)' : id === 'manual_rate' ? 'sum(man)' : 'sum(man + nor)'
    denominator = id === 'flagged_rate' ? 'sum(sections)' : 'sum(v)'
  } else if (source === 'seats') {
    numerator = id === 'parties' ? 'count(distinct bloc)' : 'sum(seats)'
    filter = `($1::text = '' or uf = $1) and $2::text = '' and office = $3`
  }
  return `select ${numerator}::float8 numerator, ${denominator}::float8 denominator, count(*) records from ${from} where ${where} and ${filter} and $3::int > 0`
}
