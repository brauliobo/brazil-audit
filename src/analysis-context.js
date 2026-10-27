// Distribution units must belong to the selected nomination's electoral jurisdiction.
export function candidateAnalysisScope(office, candidate, scope) {
  if (!candidate || candidate.identity_status === 'context_unresolved') return null
  if (office.constituencyGrain === 'national') return { ...scope }
  if (!candidate.state || candidate.state === 'br') return null
  if (office.constituencyGrain === 'state') return { ...scope, state: candidate.state }
  if (office.constituencyGrain === 'municipality' && candidate.city_code) return { ...scope, state: candidate.state, city_code: candidate.city_code }
  return null
}

export function candidateDistribution(rows, office, candidate, scope) {
  const eligible = candidateAnalysisScope(office,candidate,scope)
  if (!eligible) return []
  const observed = rows.filter((r) => (!eligible.state || r.state === eligible.state) && (!eligible.city_code || r.city_code === eligible.city_code))
  return [...Map.groupBy(observed,(r) => r.id)].map(([id, group]) => {
    const unit=group[0], found=group.find((r) => r.cand === candidate.cand)
    const complete=unit.count_meaning === 'official_nominal_valid' && unit.nominal_valid != null && unit.candidate_total != null && Number(unit.nominal_valid) === Number(unit.candidate_total)
    const votes=found ? found.votes : complete ? 0 : null
    return { ...unit,id,votes,share:votes != null && unit.candidate_total > 0 ? votes/unit.candidate_total : null }
  })
}

export function analysisDefaultState(office, requested) {
  if (requested != null) return requested
  const grains=office.capabilities.voteGrains ?? office.capabilities.grains
  return grains.every((g) => ['state','national'].includes(g)) ? 'br' : office.capabilities.states[0] ?? 'br'
}

export function analysisDefaultGrain(grains, requested, state, readyBytes, budget=8e6) {
  if (grains.includes(requested)) return requested
  return ['section','zone','municipality','state'].find((g) => grains.includes(g) && !(g==='section' && state==='br') && (g==='state' || readyBytes[g] != null && readyBytes[g]<=budget)) ?? 'state'
}
