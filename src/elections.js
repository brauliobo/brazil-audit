// The election config: ONE place read by the data build (scripts/build-data.mjs) and by the app. A new election (e.g. 2018, both turns)
// plugs in by adding an entry here; views and queries never branch on a year, they read these flags.
//   key       URL segment (/2026/...): the year for the single turn of a year, `<year>-<turn>` when a year has several (2018-2)
//   year/turn the `election` and `turn` columns of every table
//   offices   office ids on the ballot (1 president, 3 governor, 5 senator, 6 federal, 7 state, 8 district deputy); names are in the locale files
//   hasBlank  blank and null ballots were collected (NULL columns otherwise); hasTimes  voting times (tables vt, vtc); hasResidual  official totals of sections without files (tables residual*);
//   hasSeats  elected / seats tables; hasCoverage  own-sections coverage (tables cov, miss)
//   source    where the build reads it: kind 'rdv' = collector table rdv_votes (+ voting_times), 'legacy' = the 2022 table `votes`
export const ELECTIONS = {
  2022: {
    key: '2022', year: 2022, turn: 2, offices: [1],
    hasBlank: false, hasTimes: false, hasResidual: false, hasSeats: false, hasCoverage: false,
    source: { kind: 'legacy', db: 'brazil-audit' },
  },
  2026: {
    key: '2026', year: 2026, turn: 1, offices: [1, 3, 5, 6, 7, 8],
    hasBlank: true, hasTimes: true, hasResidual: true, hasSeats: true, hasCoverage: true,
    source: { kind: 'rdv', db: 'brazil-audit-2026' },
  },
}

/** The most recent election is the default everywhere. */
export const DEFAULT_ELECTION = Object.keys(ELECTIONS).at(-1)
