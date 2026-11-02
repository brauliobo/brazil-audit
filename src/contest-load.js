// Loads the parts of the canonical tables that the queries of src/contest.js read (browser only: it reads the manifest).
import { ELECTIONS } from './model.js'
import { ensure, ensureOffice, ensureSmall, isLoaded, tables } from './data.js'
import { NATIVE } from './contest.js'

const partsOf = (table, ids, officeKey, state) => Object.entries(tables()[table].parts)
  .filter(([, p]) => p.electionIds?.some((id) => ids.includes(id)) && p.officeKeys?.includes(officeKey) && (!state || (p.states ?? [p.state]).includes(state))).map(([id]) => id)

/** The parts the queries of the contest need, as [table, part] pairs: units, votes and candidates of both rounds (a president needs one list of candidates), and the municipality names of `state` (`*` for every state) when it is given. */
export function contestParts(rounds, officeKey, state) {
  const ids = [...rounds.firstIds, ...rounds.secondIds]
  const names = Object.entries(tables().election_places.parts).filter(([, p]) => p.sessionKeys.includes(ELECTIONS[rounds.second].sourceSession.key) && (state === '*' || p.states.includes(state))).map(([id]) => id)
  const roster = partsOf('election_candidates', ids, officeKey)
  return [
    ...partsOf('election_units', ids, officeKey).map((id) => ['election_units', id]), ...partsOf('election_votes', ids, officeKey).map((id) => ['election_votes', id]),
    ...(officeKey === 'president' ? roster.slice(0, 1) : roster).map((id) => ['election_candidates', id]), ...(state ? names.map((id) => ['election_places', id]) : []),
  ]
}

export const loadedCount = (parts) => parts.filter(([table, id]) => isLoaded(table, id)).length

export async function ensureContest(rounds, officeKey, state, grain) {
  if (grain === 'native') {
    await Promise.all([ensure('cands'), ...[rounds.first, rounds.second].flatMap((k) => [ensureSmall(k, 'sgz'), ensureSmall(k, 'residual'), ensureOffice('res', k, NATIVE[officeKey]), ensureOffice('tot', k, NATIVE[officeKey])])])
    return
  }
  const parts = contestParts(rounds, officeKey, state)
  await Promise.all([...new Set(parts.map(([table]) => table))].map((table) => ensure(table, parts.filter(([tb]) => tb === table).map(([, id]) => id))))
}

/** The votes, candidates and municipality names of one election and office. */
export async function ensureRound(key, officeKey) {
  const ids = ELECTIONS[key].sourceSession.eventIds
  const names = Object.entries(tables().election_places.parts).filter(([, p]) => p.sessionKeys.includes(ELECTIONS[key].sourceSession.key)).map(([id]) => id)
  await Promise.all([ensure('election_votes', partsOf('election_votes', ids, officeKey)), ensure('election_candidates', partsOf('election_candidates', ids, officeKey)), ensure('election_places', names)])
}
