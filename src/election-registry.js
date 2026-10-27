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

export function supportsView(key, view) {
  const e = ELECTIONS[key]
  if (['time', 'logs'].includes(view)) return e.hasTimes
  if (view === 'seats') return e.hasSeats
  if (view === 'parliament') return e.hasSeats || e.officeDefinitions?.some((o) => o.capabilities?.elected)
  return true
}

export const registryReady = typeof location === 'undefined' ? Promise.resolve() :
  fetch(`${import.meta.env.BASE_URL}data/elections.json`, { cache: 'no-cache' }).then(async (response) => {
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
    installElectionRegistry(await response.json())
  })
