import { parseCsvLine } from '../scripts/csv.mjs'

export const HISTORICAL_METRICS = ['abstention_rate','attendance_rate','absent','present','electorate','blank_votes','null_votes','blank_rate','null_rate','historical_valid','historical_sections','registered_electorate','not_installed']
export function historicalValue(rows,id,office,state='') {
  const candidates = rows.filter((r) => r.office_key === office && (!state || r.state === state))
  const selected = []
  for (const uf of new Set(candidates.map((r) => r.state))) {
    const local = candidates.filter((r) => r.state === uf)
    const totals = local.filter((r) => r.scope === 'state')
    if (totals.length) { selected.push(...totals); continue }
    for (const city of new Set(local.map((r) => r.city_code))) {
      const units = local.filter((r) => r.city_code === city)
      const municipal = units.filter((r) => r.scope === 'municipality')
      selected.push(...(municipal.length ? municipal : units.filter((r) => r.scope === 'zone')))
    }
  }
  const scope = [...new Set(selected.map((r) => r.scope))].join(', ')
  const field = {abstention_rate:'absent',attendance_rate:'present',absent:'absent',present:'present',electorate:'installed',registered_electorate:'eligible',not_installed:'not_installed',blank_votes:'blank',null_votes:'null',blank_rate:'blank',null_rate:'null',historical_valid:'valid',historical_sections:'sections'}[id]
  const denominatorFields = ['blank_rate','null_rate'].includes(id) ? ['blank','null','valid'] : ['installed']
  const known = selected.filter((r) => r[field] != null && (!id.endsWith('_rate') || denominatorFields.every((f) => r[f] != null)))
  const numerator = known.length ? known.reduce((n,r) => n+r[field],0) : null
  const denominator = known.length && known.every((r) => denominatorFields.every((f) => r[f] != null)) ? known.reduce((n,r) => n+denominatorFields.reduce((a,f) => a+r[f],0),0) : null
  return {value:numerator == null ? null : id.endsWith('_rate') ? denominator > 0 ? numerator/denominator : null : numerator,numerator,denominator,units:known.length,totalUnits:selected.length,scope,states:[...new Set(known.map((r) => r.state))].sort().join(', ')}
}
export function parseHistoricalCsv(text) {
  const [header,...lines] = text.trimEnd().split('\n').map(parseCsvLine)
  const numeric = new Set(['eligible','installed','present','absent','blank','null','valid','sections','not_installed','transit'])
  return lines.map((row) => Object.fromEntries(header.map((key,i) => [key,numeric.has(key) ? row[i] === '' ? null : Number(row[i]) : row[i]])))
}
