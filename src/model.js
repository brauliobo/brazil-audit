// Election metadata (src/elections.js) and the shared schema's helpers: every election lives in the same tables, told apart by the
// `election` and `turn` columns; the views below give the section-level and rollup shapes once for all of them:
//   sec (election,turn,state,city,zone,section,model,office,nominal,blank,nul)        one row per section and office
//   cs  (election,turn,state,city,zone,section,model,office,cand,votes,nominal)       one row per section, office and candidate
//   resx / totx  res / tot plus the official totals of sections without published files (residual)
import { ELECTIONS, ELECTION_LIST } from './elections.js'

export { DEFAULT_ELECTION, ELECTIONS, ELECTION_LIST } from './elections.js'

/** The election whose parliament the Parlamento tab opens when the current one has no seats data. */
export const SEATS_ELECTION = ELECTION_LIST.findLast((e) => e.hasSeats).key

/** The key of the election of a year and turn (as stored in the `election` and `turn` columns), if it is configured. */
export const electionKey = (year, turn) => ELECTION_LIST.find((e) => e.year === year && e.turn === turn)?.key

/** `election = 2026 and turn = 1` for an election key, optionally on a table alias. */
export const inElection = (key, alias = '') => {
  const [e, a] = [ELECTIONS[key], alias ? `${alias}.` : '']
  return `${a}election = ${e.year} and ${a}turn = ${e.turn}`
}

/** Views of the main navigation (their labels are nav.<id> in the locale files). */
export const VIEWS_NAV = ['overview', 'maps', 'parliament', 'seats', 'drill', 'analysis', 'time', 'sql']

/** Routes outside the main navigation (linked from the footer). */
export const HIDDEN_VIEWS = ['design']

/** Federative units plus `zz` (votes abroad); their names are states.<uf> in the locale files. */
export const UFS = ['ac', 'al', 'am', 'ap', 'ba', 'ce', 'df', 'es', 'go', 'ma', 'mg', 'ms', 'mt', 'pa', 'pb', 'pe', 'pi', 'pr', 'rj', 'rn', 'ro', 'rr', 'rs', 'sc', 'se', 'sp', 'to', 'zz']

/** Theme choices of the switcher, in display order. */
export const THEMES = ['light', 'system', 'dark']

export const INDEXES = [
  'create index if not exists cands_ix on cands (election, office, uf, n)',
  'create index if not exists rdv_ix on rdv (election, turn, state, city)',
  'create index if not exists res_ix on res (election, turn, state, office)',
  'create index if not exists tot_ix on tot (election, turn, state, office)',
  'create index if not exists vt_ix on vt (election, turn, state, city)',
]

export const VIEWS = [
  'create or replace view sec as select election, turn, state, city, zone, section, model, office, nominal, blank, nul from rdv',
  `create or replace view cs as select r.election, r.turn, r.state, r.city, r.zone, r.section, r.model, r.office, e.key cand, e.value::int votes, r.nominal
    from rdv r, jsonb_each_text(r.votes) e`,
  `create or replace view resx as select election, turn, state, city, office, cand, votes from res
    union all select election, turn, uf, city, office, number, votes from residual where number not in ('branco', 'nulo')`,
  `create or replace view totx as select election, turn, state, city, office, sections, nominal, blank, nul from tot
    union all select election, turn, uf, city, office, 0, sum(votes) filter (where number not in ('branco', 'nulo')), coalesce(sum(votes) filter (where number = 'branco'), 0),
      coalesce(sum(votes) filter (where number = 'nulo'), 0) from residual group by election, turn, uf, city, office`,
]

/** Joins a cs/res alias to its candidate name: presidential candidates are national, all others per state. */
export const candJoin = (key, alias = 'cs') =>
  `left join cands c on c.election=${ELECTIONS[key].year} and c.turn=${ELECTIONS[key].turn} and c.office=${alias}.office and c.n=${alias}.cand and c.uf=(case when ${alias}.office=1 then 'br' else ${alias}.state end)`

/** Per-section presidential votes of candidate `$1` (zero when absent) with the section's nominal total. */
export const candVotes = (key) => `select state,city,zone,section,model,nominal,coalesce((votes->>$1)::int, 0) votes from rdv where office = 1 and ${inElection(key)}`

/** Time-of-day buckets (vt.b / vtc.b): bucket 0 starts at 05:00 on the recorded local clock, 10 minutes each. */
export const BUCKET = { start: 5 * 3600, step: 600 }

/** Accent- and case-insensitive key of a name: `são paulo` and `SAO PAULO` fold to the same value. */
export const fold = (col) => `upper(translate(${col}, 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ', 'AAAAAEEEEIIIIOOOOOUUUUCNAAAAAEEEEIIIIOOOOOUUUUCN'))` // i18n-ignore

/** PGlite sorts in C.UTF-8 codepoint order (accented letters after Z): this key orders Portuguese names like pt-BR. */
export const collate = (col) => `translate(${col}, 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ', 'AAAAAEEEEIIIIOOOOOUUUUCN')` // i18n-ignore
