// Runtime elections are source identities, not a list of collector databases.
// Keep the six collector configurations in elections.js for the data builders.
import { ELECTION_LIST as COLLECTOR_LIST, DEFAULT_ELECTION } from './elections.js'

export { DEFAULT_ELECTION }
export const ELECTION_LIST = COLLECTOR_LIST.map((e) => ({ ...e, legacyKey: e.key }))
export const ELECTIONS = Object.fromEntries(ELECTION_LIST.map((e) => [e.key, e]))
export let electionRegistry = null

export function runtimeElections(registry) {
  return registry.sessions.map((session) => {
    const legacy = COLLECTOR_LIST.find((e) => e.key === (session.legacyKey ?? session.key))
    return {
      ...session,
      ...(legacy ?? {}),
      key              : session.key,
      legacyKey        : legacy?.key ?? null,
      officeDefinitions: session.offices,
      offices          : session.offices.map((o) => Number(o.id)),
      description      : session.description,
      sourceSession    : session,
      hasTimes         : legacy?.hasTimes ?? false,
      hasSignals       : legacy?.hasSignals ?? false,
      hasSeats         : legacy?.hasSeats ?? false,
      hasCoverage      : legacy?.hasCoverage ?? false,
      hasResidual      : legacy?.hasResidual ?? false,
      hasBlank         : true,
      hasTurnout       : true,
      sources          : legacy?.sources ?? { logs: false, rdv: false, open: true, official: [], pending: [], differences: {} },
      raw              : legacy?.raw ?? {},
      source           : legacy?.source ?? { kind: 'historical' },
    }
  })
}

export function installElectionRegistry(registry) {
  const entries = runtimeElections(registry)
  for (const entry of ELECTION_LIST) delete ELECTIONS[entry.key]
  Object.assign(ELECTIONS, Object.fromEntries(entries.map((e) => [e.key, e])))
  ELECTION_LIST.splice(0, ELECTION_LIST.length, ...entries)
  electionRegistry = registry
}

/** Source office keys remain distinct even when old numeric codes coincide. */
export function selectedOffice(key, requested) {
  const definitions = ELECTIONS[key].officeDefinitions
  const preferred = ['president','governor','mayor'].map((key) => definitions.find((o) => o.key === key)).find(Boolean)
  return definitions.find((o) => o.key === requested || String(o.id) === String(requested)) ?? preferred ?? definitions[0]
}

export function contextState(office, requested) {
  if (requested != null) return requested
  return office.constituencyGrain === 'municipality' ? office.capabilities.states.find((state) => state && state !== 'br' && state !== 'zz') ?? '' : ''
}

export function contextParams(key, params, newElection = false) {
  const result = { ...params }
  const office = selectedOffice(key,result.office)
  if (result.office != null) result.office = office.key
  if (result.state && !office.capabilities.states.includes(result.state)) { delete result.state; delete result.city }
  if (newElection) { delete result.city; delete result.cand }
  return result
}

export function territorialGrain(office) {
  if (office.constituencyGrain === 'municipality') return 'municipality'
  if (['national','state'].includes(office.constituencyGrain)) return 'state'
  return null
}

export function currentStateGeometry(key, states, geometryCodes) {
  const temporalCompatible = ELECTIONS[key].year >= 1990
  const mappedCodes = temporalCompatible ? states.filter((state) => geometryCodes.includes(state)) : []
  const unmappedCodes = states.filter((state) => !mappedCodes.includes(state))
  return { temporalCompatible, mappedCodes, unmappedCodes, available: mappedCodes.length > 0 }
}

/** The offices whose runoff can be compared with the first round: president, governor and mayor, in the order the shift view offers them. */
export const SHIFT_OFFICES = ['president', 'governor', 'mayor']

/** The first round of a runoff: the same year (or, for the 2020 municipal events, the previous event number), when it holds the office too. */
export function firstRoundOf(key, officeKey) {
  const e = ELECTIONS[key]
  if (e?.turn !== 2 || !/^(\d{4}-2|e-2020-(427|446)-2-.*)$/.test(key)) return null
  const has = (o) => !officeKey || o.officeDefinitions?.some((d) => d.key === officeKey)
  const number = key.match(/^e-(\d{4})-(\d+)-2-/)
  const match = (o) => (number ? o.key.startsWith(`e-${number[1]}-${+number[2] - 1}-1-`) : o.year === e.year)
  const ordinary = ELECTIONS[String(e.year)]
  if (!number && ordinary?.turn === 1 && has(ordinary)) return ordinary.key
  return ELECTION_LIST.find((o) => o.turn === 1 && match(o) && has(o))?.key ?? null
}

/** The runoff to compare a round with: the election itself when it is a runoff, else the runoff whose first round it is. */
export const runoffOf = (key) => (ELECTIONS[key]?.turn === 2 ? key : ELECTION_LIST.find((o) => o.turn === 2 && SHIFT_OFFICES.some((office) => firstRoundOf(o.key, office) === key))?.key ?? null)

/** The offices of SHIFT_OFFICES that both rounds of the runoff hold. */
export const shiftOffices = (key) => SHIFT_OFFICES.filter((o) => ELECTIONS[key]?.officeDefinitions?.some((d) => d.key === o) && firstRoundOf(key, o))

export function supportsView(key, view) {
  const e = ELECTIONS[key]
  if (['time', 'logs'].includes(view)) return e.hasTimes
  if (view === 'seats') return e.hasSeats
  if (view === 'shift') return shiftOffices(runoffOf(key) ?? key).length > 0
  if (view === 'biometrics') return !!e.hasSignals && !!e.sources?.logs
  if (view === 'parliament') return e.hasSeats || e.officeDefinitions?.some((o) => ['elected','declaredSeats','listMetadata','candidateListLinks'].some((capability) => o.capabilities?.[capability]))
  return true
}

export const registryReady = typeof location === 'undefined' ? Promise.resolve() :
  fetch(`${import.meta.env.BASE_URL}data/elections.json`, { cache: 'no-cache' }).then(async (response) => {
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
    installElectionRegistry(await response.json())
  })
