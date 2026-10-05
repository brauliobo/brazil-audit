// What is shipped (the size budget decides): which series exist in which places, and how deep.
//   place   'br' (national) or a UF; a series has one row per place that shows it
//   big     the place also gets the municipality and UF units (candidate votes per municipality / per UF)
//   d12     the place also gets the first-two-digits histogram (when N allows it)
//   mun     the series also gets municipality places (those with at least munSections(office) sections), first and second digit only
export const PARAMS = {
  reps: 200,
  seed: 20261004,
  nationalShare: 0.01, // president: candidates with this share of the national nominal votes
  localShare: 0.03, // governor, senator, deputy parties: share of the UF's nominal votes
  bigShare: 0.1, // local candidates that also get d12 and the city/UF units
  munNationalShare: 0.05, // president candidates with municipality places
  munLocalShare: 0.3, // local candidates with municipality places
  munSections: { 1: 100, other: 200 }, // municipalities with fewer sections than this have no places of their own
}
export const munSections = (office) => PARAMS.munSections[office] ?? PARAMS.munSections.other

const PSEUDO = ['nominal', 'branco', 'nulo']
const NATIONAL_OFFICE = 1 // the only office whose candidates are the same in every UF
const PARTY_OFFICES = [6, 7, 8]

/**
 * totals: [{ uf, cand, votes }] of one office (every UF that has it, pseudo candidates included).
 * Returns the series rows [{ uf, cand, big, d12, mun }], uf = 'br' for national places.
 */
export function plan(office, totals) {
  const nominal = new Map(totals.filter((t) => t.cand === 'nominal').map((t) => [t.uf, t.votes]))
  const nationalNominal = [...nominal.values()].reduce((t, v) => t + v, 0)
  const [national, party] = [office === NATIONAL_OFFICE, PARTY_OFFICES.includes(office)]
  const rows = []
  const row = (uf, cand, big, d12, mun) => rows.push({ uf, cand, big, d12, mun })

  // without blank and null votes the nominal total is the section size itself (turnout): its baseline would be the data
  const hasBlank = totals.some((t) => t.cand === 'branco')
  for (const cand of PSEUDO.filter((c) => hasBlank && totals.some((t) => t.cand === c))) {
    if (nominal.size > 1) row('br', cand, true, true, cand === 'nominal')
    for (const uf of nominal.keys()) row(uf, cand, true, cand === 'nominal', nominal.size === 1 && cand === 'nominal')
  }
  for (const [cand, list] of Map.groupBy(totals.filter((t) => !PSEUDO.includes(t.cand)), (t) => t.cand)) {
    const share = list.reduce((t, x) => t + x.votes, 0) / nationalNominal
    if (national && share >= PARAMS.nationalShare) {
      row('br', cand, true, true, share >= PARAMS.munNationalShare)
      for (const uf of nominal.keys()) row(uf, cand, true, true, false)
    } else if (!national) {
      if (party && share >= PARAMS.localShare) row('br', cand, false, false, false)
      for (const { uf, votes } of list) {
        const local = votes / nominal.get(uf)
        if (local >= PARAMS.localShare) row(uf, cand, !party && local >= PARAMS.bigShare, false, !party && local >= PARAMS.munLocalShare)
      }
    }
  }
  return rows
}
