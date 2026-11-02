// The data of a runoff and its first round for one office, at the finest territorial grain the source has (zone, else municipality, else state):
// the units (electorate, turnout, blank, null, nominal votes) and the candidates' votes of each, from the canonical election_* tables that every election has.
import { ELECTIONS, firstRoundOf } from './election-registry.js'

/** A president runs in one contest for the country, a governor in one per state, a mayor in one per municipality. */
export const DEPTH = { president: 0, governor: 1, mayor: 2 }

/** The two rounds of a runoff, with the event ids of each. */
export function roundsOf(key, officeKey) {
  const first = firstRoundOf(key, officeKey)
  const events = (k) => ELECTIONS[k].sourceSession.eventIds
  return first ? { first, second: key, firstIds: events(first), secondIds: events(key) } : null
}

export const NATIVE = { president: 1, governor: 3 } // the offices of the collector tables (res, tot, sgz) of the elections whose canonical tables have no votes yet

/** The finest grain both rounds have votes for; `native` is the municipality rollups of the collector tables, for the runoffs that have no canonical votes. */
export function grainOf(rounds, officeKey) {
  const grains = [rounds.first, rounds.second].map((k) => ELECTIONS[k].officeDefinitions.find((d) => d.key === officeKey)?.capabilities?.sources?.votes?.grains ?? [])
  const found = ['zone', 'municipality', 'state'].find((g) => grains.every((list) => list.includes(g)))
  return found ?? ([rounds.first, rounds.second].every((k) => ELECTIONS[k].legacyKey) && NATIVE[officeKey] ? 'native' : null)
}

const SCOPE = ` and ($4::text is null or u.state = $4) and ($5::text is null or u.city_code = $5)`
const TURN = `case when u.election_id = any($1::text[]) then 1 else 2 end`

/** The units of both rounds, one row per round and place: the electorate, who turned out, blank, null and nominal votes. */
export const unitsSql = (rounds, officeKey, grain, state, city) => (grain === 'native' ? nativeUnitsSql(rounds, officeKey, state, city) : {
  sql: `select ${TURN} turn, u.state, u.city_code city, coalesce(u.zone, '') zone, u.eligible::bigint eligible, u.present::bigint present, u.blank::bigint blank, u.null_votes::bigint nul, u.nominal::bigint nominal
    from election_units u where u.election_id = any($6::text[]) and u.office_key = $2 and u.grain = $3 and coalesce(u.transit, 'N') <> 'S'${SCOPE}`,
  params: [rounds.firstIds, officeKey, grain, state ?? null, city ?? null, [...rounds.firstIds, ...rounds.secondIds]],
})

/** The votes of each candidate (by number) in each place and round. */
export const votesSql = (rounds, officeKey, grain, state, city) => (grain === 'native' ? nativeVotesSql(rounds, officeKey, state, city) : {
  sql: `select ${TURN} turn, u.state, u.city_code city, coalesce(u.zone, '') zone, u.number, sum(u.votes)::bigint votes
    from election_votes u where u.election_id = any($6::text[]) and u.office_key = $2 and u.grain = $3 and u.kind = 'candidate' and coalesce(u.transit, 'N') <> 'S'${SCOPE} group by 1, 2, 3, 4, 5`,
  params: [rounds.firstIds, officeKey, grain, state ?? null, city ?? null, [...rounds.firstIds, ...rounds.secondIds]],
})

// The collector tables (res, tot, sgz) have the municipality rollups of both rounds, with the municipality name for `city` and no zone.
const year = (rounds) => ELECTIONS[rounds.second].year
const nativeUnitsSql = (rounds, officeKey, state, city) => ({
  sql: `with t as (select turn, state, city, sum(nominal) nominal, sum(blank) blank, sum(nul) nul from totx where election = $1 and office = $2 and ($3::text is null or state = $3) and ($4::text is null or city = $4) group by 1, 2, 3),
    z as (select turn, state, city, sum(aptos) eligible, sum(comp) present from sgz where election = $1 and ($3::text is null or state = $3) and ($4::text is null or city = $4) group by 1, 2, 3)
    select turn, state, city, ''::text zone, eligible, present, blank, nul, nominal from t full join z using (turn, state, city)`, // i18n-ignore
  params: [year(rounds), NATIVE[officeKey], state ?? null, city ?? null],
})
const nativeCandidatesSql = (rounds, officeKey, state) => ({
  sql: `select distinct on (uf, n) case when uf = 'br' then null else uf end state, null::text city, n number, coalesce(short_name, name) name, party from cands
    where election = $1 and office = $2 and ($3::text is null or uf in ($3, 'br')) order by uf, n, turn desc`, // i18n-ignore
  params: [year(rounds), NATIVE[officeKey], state ?? null],
})
const nativeVotesSql = (rounds, officeKey, state, city) => ({
  sql: `select turn, state, city, ''::text zone, cand number, sum(votes)::bigint votes from resx where election = $1 and office = $2 and ($3::text is null or state = $3) and ($4::text is null or city = $4) group by 1, 2, 3, 4, 5`, // i18n-ignore
  params: [year(rounds), NATIVE[officeKey], state ?? null, city ?? null],
})

/** The candidates (state, municipality, number, name, party) of the contest, from either round; a president has one list for the country. */
export const candidatesSql = (rounds, officeKey, state, grain) => (grain === 'native' ? nativeCandidatesSql(rounds, officeKey, state) : {
  sql: `select distinct on (${officeKey === 'president' ? '' : 'c.state, c.constituency, '}c.number) ${officeKey === 'president' ? 'null::text' : 'c.state'} state, ${officeKey === 'mayor' ? 'c.constituency' : 'null::text'} city, c.number, coalesce(c.short_name, c.name) name, c.party
    from election_candidates c where c.election_id = any($1::text[]) and c.office_key = $2 and c.candidate_id not like 'party_list:%' and ($3::text is null or c.state = $3) order by ${officeKey === 'president' ? '' : 'c.state, c.constituency, '}c.number, c.name`, // i18n-ignore
  params: [[...rounds.firstIds, ...rounds.secondIds], officeKey, officeKey === 'president' ? null : state ?? null],
})

/** The names of the municipalities of the runoff by their source code. */
export const placesSql = (rounds, state, grain) => ({
  sql: `select state, city_code city, city_name name from election_places where session_key = $1 and ($2::text is null or state = $2)`,
  params: [grain === 'native' ? '' : ELECTIONS[rounds.second].sourceSession.key, state ?? null], // the collector tables name the municipalities already
})

/** The votes of each candidate (by number) in each municipality, in one election and for one office, at the grain of the source. */
export const roundVotesSql = (key, officeKey, grain) => ({
  sql: `select u.state, u.city_code city, u.number, sum(u.votes)::bigint votes from election_votes u where u.election_id = any($1::text[]) and u.office_key = $2 and u.grain = $3
    and u.kind = 'candidate' and coalesce(u.transit, 'N') <> 'S' group by 1, 2, 3`,
  params: [ELECTIONS[key].sourceSession.eventIds, officeKey, grain],
})

/** The candidates (state, number, name, party) of one election and office. */
export const roundCandidatesSql = (key, officeKey) => ({
  sql: `select distinct on (c.state, c.number) c.state, c.number, coalesce(c.short_name, c.name) name, c.party from election_candidates c
    where c.election_id = any($1::text[]) and c.office_key = $2 and c.candidate_id not like 'party_list:%' order by c.state, c.number, c.name`, // i18n-ignore
  params: [ELECTIONS[key].sourceSession.eventIds, officeKey],
})

/** The finest grain one election has votes for, for an office. */
export const roundGrainOf = (key, officeKey) => grainOf({ first: key, second: key }, officeKey)
