// The election config: ONE place read by the data build (scripts/build-data.mjs) and by the app. A new election or round (e.g. the
// 2026 runoff) plugs in by adding an entry here; views and queries never branch on a year, they read these flags.
//   key       URL segment (/2022/...): `<year>` for the first round, `<year>-<turn>` for later ones (/2022-2)
//   year/turn the `election` and `turn` columns of every table
//   offices   office ids on the ballot (1 president, 3 governor, 5 senator, 6 federal, 7 state, 8 district deputy); names are in the locale files
//   hasBlank  blank and null ballots were collected (NULL columns otherwise); hasTimes  voting times (tables vt, vtc); hasResidual  official totals of sections without files (tables residual*);
//   hasSeats  elected / seats tables; hasCoverage  own-sections coverage (tables cov, miss)
//   seatRule  the proportional rule of its deputy offices (an id of src/seats/rules.js); the Cadeiras view recomputes the seats with it
//   sources   the layers of evidence, in priority order (1 logs > 2 rdv > 3 open > 4 official), as they stand for this election:
//             logs  the machines' logs (every vote with its time; only the office, never the candidate): feed the voting times, tables vt/vtc, and the ballot counts
//             rdv   the machine's own record of the votes per section and candidate: feeds rdv, res, tot and everything derived
//             open  TSE open data (votacao_secao): feeds the same tables only when neither logs nor rdv exist
//             official  official TSE totals: 'residual' adds the votes of sections without files (tables residual*), 'check' = verify scripts
//             pending   layers the collector is still importing: shown as such, never as used
//             logs/rdv/open must agree with hasTimes and source.kind (checked below), so this entry cannot drift from the data
//   raw       where the raw files behind the dump are published: `tag` = GitHub release of `repo` (per-section zips, see INDEX.json), `indexDir` = its
//             folder under RAW_INDEX_DIR, `branch` + `code` = the collector code, `coverage` = lists in that branch, `tseAux` = the TSE URL of a section's aux.json;
//             without `tag` only the collector is linked
//   source    where the build reads it: kind 'rdv' = the 2026 collector (rdv_votes with the urn model + voting_times),
//             'open' = the TSE open-data collector of 2018/2022 (rdv_votes per round, section_detail, candidates, elected; no voting times)
export const REPO = 'brauliobo/brazil-audit'
const FULL = [1, 3, 5, 6, 7, 8]
const RUNOFF = [1, 3] // the second round only elects president and governors

const open = (year, turn, seatRule) => ({
  key: turn === 1 ? `${year}` : `${year}-${turn}`, year, turn, offices: turn === 1 ? FULL : RUNOFF,
  hasBlank: true, hasTimes: false, hasResidual: false, hasSeats: turn === 1, hasCoverage: false, seatRule,
  sources: { logs: false, rdv: false, open: true, official: ['check'], pending: year === 2022 ? ['logs', 'rdv'] : [] }, // 2018: the TSE published neither RDV nor logs
  raw: { branch: '2018', code: [] },
  source: { kind: 'open', db: `brazil-audit-${year}` },
})

const elections = [
  open(2018, 1, 'coalitions2018'), open(2018, 2), open(2022, 1, 'stf2024'),
  // the runoff of 2022 also has its RDV, logs and aux files (release data-2022)
  { ...open(2022, 2), raw: { tag: 'data-2022', indexDir: 'meta-2022', branch: '2022', code: ['script.rb'] } },
  {
    key: '2026', year: 2026, turn: 1, offices: FULL,
    hasBlank: true, hasTimes: true, hasResidual: true, hasSeats: true, hasCoverage: true, seatRule: 'stf2024',
    sources: { logs: true, rdv: true, open: false, official: ['residual', 'check'], pending: [] },
    raw: {
      tag: 'data-2026', indexDir: 'meta-2026', branch: '2026', code: ['lib/rdv.rb', 'lib/voting_log.rb'], coverage: ['coverage/missing-2026.tsv', 'coverage/summary-2026.tsv'],
      tseAux: 'https://resultados.tse.jus.br/oficial/ele2026/arquivo-urna/3220/dados/{uf}/{city}/{zone}/{section}/p003220-{uf}-m{city}-z{zone}-s{section}-aux.json',
    },
    source: { kind: 'rdv', db: 'brazil-audit-2026' },
  },
]
for (const e of elections) {
  const { logs, rdv, open: openData } = e.sources
  if (logs !== e.hasTimes || rdv !== (e.source.kind === 'rdv') || openData !== (e.source.kind === 'open') || e.sources.official.includes('residual') !== e.hasResidual) {
    throw new Error(`election ${e.key}: sources disagree with hasTimes / source.kind / hasResidual`)
  }
}

/** Chronological (year, then round): an object would list the year-only keys first. */
export const ELECTION_LIST = elections
export const ELECTIONS = Object.fromEntries(elections.map((e) => [e.key, e]))

/** The most recent election is the default everywhere. */
export const DEFAULT_ELECTION = elections.at(-1).key
