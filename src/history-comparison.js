import { parseCsvLine } from '../scripts/csv.mjs'

export const HISTORICAL_DEFINITIONS = {
  abstention_rate:       {field:'absent',denominator:'installed',unit:'fraction'},
  attendance_rate:       {field:'present',denominator:'installed',unit:'fraction'},
  absent:                {field:'absent',denominator:null,unit:'voters'},
  present:               {field:'present',denominator:null,unit:'voters'},
  electorate:            {field:'installed',denominator:null,unit:'voters'},
  blank_votes:           {field:'blank',denominator:null,unit:'votes'},
  null_votes:            {field:'null',denominator:null,unit:'votes'},
  blank_rate:            {field:'blank',denominator:'ballots',unit:'fraction'},
  null_rate:             {field:'null',denominator:'ballots',unit:'fraction'},
  historical_valid:      {field:'valid',denominator:null,unit:'votes'},
  historical_sections:   {field:'sections',denominator:null,unit:'sections'},
  registered_electorate: {field:'eligible',denominator:null,unit:'voters'},
  not_installed:         {field:'not_installed',denominator:null,unit:'voters'},
  ballot_votes:          {field:'ballots',denominator:null,unit:'votes'},
  null_total_votes:      {field:'null_total',denominator:null,unit:'votes'},
  technical_null_votes:  {field:'null_technical',denominator:null,unit:'votes'},
  annulled_votes:        {field:'annulled',denominator:null,unit:'votes'},
  subjudice_votes:       {field:'annulled_subjudice',denominator:null,unit:'votes'},
  separate_votes:        {field:'annulled_separate',denominator:null,unit:'votes'},
}
export const HISTORICAL_METRICS = Object.keys(HISTORICAL_DEFINITIONS)
export function historicalValue(rows,id,office,state='',city='',zone='') {
  const candidates = rows.filter((r) => r.office_key === office && (!state || r.state === state) && (!city || r.city_code === city) && (!zone || r.zone === zone))
  const selected = []
  for (const uf of new Set(candidates.map((r) => r.state))) {
    const local = candidates.filter((r) => r.state === uf)
    const totals = local.filter((r) => r.scope === 'state')
    if (totals.length) { selected.push(...totals); continue }
    for (const code of new Set(local.map((r) => r.city_code))) {
      const units = local.filter((r) => r.city_code === code)
      const municipal = units.filter((r) => r.scope === 'municipality')
      selected.push(...(municipal.length ? municipal : units.filter((r) => r.scope === 'zone')))
    }
  }
  const scope = [...new Set(selected.map((r) => r.scope))].join(', ')
  const {field,denominator:base} = HISTORICAL_DEFINITIONS[id]
  const known = selected.filter((r) => r[field] != null && (!base || r[base] != null))
  const numerator = known.length ? known.reduce((n,r) => n+r[field],0) : null
  const denominator = base && known.length ? known.reduce((n,r) => n+r[base],0) : null
  const value = numerator == null ? null : base ? denominator > 0 ? numerator/denominator : null : numerator
  let reason = null
  if (!selected.length) reason = 'no_matching_units'
  else if (!known.length) {
    const missingBase = base && selected.some((r) => r[field] != null && r[base] == null)
    const incompatibleBallots = (base === 'ballots' || field === 'ballots') && selected.some((r) => r.ballots == null && r.ballots_reported != null)
    if (incompatibleBallots) reason = 'incompatible_ballot_total'
    else if (missingBase) reason = base === 'ballots' ? 'missing_ballot_total' : 'missing_participation_base'
    else reason = 'missing_metric'
  } else if (value == null) reason = 'empty_denominator'
  else if (known.length < selected.length) reason = 'partial_known_units'
  return {value,numerator,denominator,units:known.length,totalUnits:selected.length,scope,states:[...new Set(known.map((r) => r.state))].sort().join(', '),reason}

}
export function parseHistoricalCsv(text) {
  const [header,...lines] = text.trimEnd().split('\n').map(parseCsvLine)
  const numeric = new Set(['ballots','ballots_reported','null_total','null_technical','annulled','annulled_subjudice','annulled_separate','eligible','installed','present','absent','blank','null','valid','sections','not_installed','transit'])
  return lines.map((row) => Object.fromEntries(header.map((key,i) => [key,numeric.has(key) ? row[i] === '' ? null : Number(row[i]) : row[i]])))
}
