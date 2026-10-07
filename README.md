<p align="center"><img src="public/logo.svg" alt="Auditoria eleitoral" height="48"></p>

# Brazil audit

Static analytics app for a Brazilian election audit. The repository is a database dump (`data/`) plus a Vue app that
loads it into **PostgreSQL running in the browser** ([PGlite](https://pglite.dev), WASM, in a Web Worker) and runs real
SQL for every view: overview, drill-down (UF → município → zona → seção), analysis (histogram, z-score outliers,
scatter, Benford, blank/null rates), voting time of day, and a SQL console. Hosted on GitHub Pages
(https://brauliobo.github.io/brazil-audit/), no backend.

Stack: Vue 3.6 (rc) **Vapor mode** + **Pug** SFC templates, Vite 8, PGlite 0.5.8, hand-written SVG/canvas charts
(no chart dependency: four small components, themable with CSS variables, a fraction of uPlot/Chart.js size).

## Develop, build, deploy

```sh
npm ci
BASE_PATH=/ npm run dev      # http://localhost:5173/
npm run build                # dist/, base path /brazil-audit/ unless BASE_PATH is set
npm run preview
```

- `BASE_PATH` is the URL prefix: `/<repo>/` for a project page (the workflow sets it from the repository name), `/` for a
  user page or custom domain. See "Routes" below.
- `.github/workflows/pages.yml` runs `npm ci`, `npm run build` and deploys `dist` with the official Pages actions. Enable
  Pages with source "GitHub Actions" in the repository settings. Nothing is downloaded at build time.
- Pages limits: 1 GB site, 100 MB per file. Largest file is the 9.6 MB `pglite.wasm`; the data parts are 13 KB - 4.4 MB.
- Browser checks against the built site (`node scripts/serve-pages.mjs 4190`, driving `agent-browser`): `npm run check:responsive`
  (overflow, touch targets, form fonts) and `npm run check:usability`, which measures the ISO 9241-11 triad on ten visitor tasks
  (desktop and 375 px phone, cold start): effectiveness (completion, errors), efficiency (time on task, interactions against the
  shortest path, goals per minute) and satisfaction (proxies: errors, feedback while waiting, layout shift; with `--sus=answers.json`
  the System Usability Scale score of real respondents joins the report). It fails when a task is not completed, is over its budget,
  takes more interactions than its shortest path, or a proxy fails.

## Routes

Real paths with the History API under the base: `/<election>/<view>/<args…>?<state>`, e.g. `/brazil-audit/2026/maps?scope=state&uf=sp`,
`/2026/drill/sp/SAO%20PAULO/0372`, `/2026/sql?q=…`. The first segment is the election (omitted = the latest), the view is
`overview | maps | parliament | seats | drill | analysis | time | sql`; the rest of the state (office, metric, candidate, scope, sort,
page, query) is in the query string. `src/router.js` is the whole router: `href()` builds the paths (base included) so every
link is a plain `<a href>`, one delegated click handler navigates in place (modified clicks, `target`, `download`, other
origins and in-page `#anchors` keep their native behaviour), back/forward restore the scroll position, the document title
follows the route and focus moves to the page heading. Old `#/…` links are converted to the new URL on load.

GitHub Pages has no rewrites, so the static fallback is: the build copies `index.html` into `/<election>/` and
`/<election>/<view>/` (HTTP 200); any other path (a drill-down with place names, a time chart for a UF) gets `404.html`, which
redirects to the base index with the path in the query (the spa-github-pages technique) and an inline script in `index.html`
restores the real URL with `history.replaceState` before the app mounts. Caveat: those deep links are answered by Pages with HTTP 404
although the app loads fine (browsers do not care, crawlers and link checkers see the status). `node scripts/serve-pages.mjs [port] [base]`
serves `dist/` with exactly these semantics (no rewrites, 301 for directories, 404.html with status 404) to test the build.

## Data (`data/`) and the SQL schema

Every election lives in the **same tables**, told apart by the `election` and `turn` columns; the elections are configured once in
`src/elections.js` (read by `scripts/build-data.mjs` and by the app) and the URL keeps the election first: `/2026/...`, the first round of a
year is `/<year>/...` and a later one `/<year>-<turn>/...` (`/2018`, `/2018-2`, `/2022`, `/2022-2`; the 2026 runoff plugs in with one more
entry of the config). A bare `/2022/...` used to be the runoff of the first version of the site: it is now the first round, the runoff is `/2022-2/...`. `data/manifest.json` lists the tables (DDL,
columns) and their parts (`<election>/<part>`, url, rows, bytes, and the `where` that identifies the rows of a part so a re-import
replaces them). Parts are gzip CSV, loaded lazily with `COPY ... FROM '/dev/blob'` (inflated with `DecompressionStream`):
`data/<table>/<election>[-<uf>].csv.gz`, deputy offices of 2026 as separate parts (`-sp.6`, `-sp.7`). Brotli is not usable: browsers
cannot decode it from JS and Pages does not serve `.br`. `data/` is 383 MB, no file above 13 MB.

| table | columns after `election int, turn int` | purpose |
|---|---|---|
| `rdv` | state, city, zone, section, model, office, nominal, blank, nul, votes jsonb | section results per office; `votes` = {number: votes} (RDV kind 2); `model` is empty for 2018/2022 (the open data has no urn model) |
| `tot` | state, city, office, sections, nominal, blank, nul | totals per municipality and office |
| `res` | state, city, office, cand, votes | votes per candidate (municipality; deputies per UF, `city` NULL) |
| `vt` | state, city, zone, section, model, n, first, last, med, p10, p90, maxgap, b smallint[] | voting times per section (president post, 90 ten-minute buckets of the local clock); 2026 and 2022 (both rounds, from the machines' logs) |
| `vtc` | state, city, sections, n, tz, b int[] | city rollup of `vt` + estimated clock offset vs Brasília; 2026 and 2022 |
| `cov`, `miss` | state, own, stored, aggregated, missing / state, city, zone, section | coverage per UF and the sections without published files; 2026 only |
| `residual`, `residual_skipped` | uf, city, city_code, zone, office, number, votes, sections_missing / uf, city, zone, office, reason, detail | official totals of sections without files (see below) and the cases left out; 2026 only |
| `elected`, `seats` | uf, office, n, name, party, status, votes / uf, office, bloc, seats | elected senators and seats per party (2026: per party/federation as the TSE assigns them); first rounds only |
| `cands` | election, turn, uf, office, n, name, short_name, party, official_votes | candidate names, parties and the national president totals (2026: the TSE file; 2018/2022: the sum of the section results, which equals the TSE totals) |
| `mun_map` | state, city, ibge | municipality (TSE name) → IBGE code (no election) |

Views: `sec` (rdv without the jsonb), `cs` (one row per section, office and candidate), `resx`/`totx` (res/tot plus the residual). What an
election did not collect is absent, never invented: 2018 has no `vt`/`vtc` (the TSE published no logs), 2018 and 2022 have no residual and no coverage tables; runoffs only have president and governors.
Indexes on (election, turn, state ...) are created by the app.

### Sources and their priority

Four layers of evidence, in priority order: **1. the machines' logs** (every vote with its time, only the office, never the candidate: voting
times, tables `vt`/`vtc`, and the ballot counts per section and office), **2. the RDV** (the machine's own record of the votes per section and
candidate: tables `rdv`, `res`, `tot` and everything derived), **3. TSE open data** (`votacao_secao` bulletins, used only when 1 and 2 do not exist)
and **4. official totals** (the residual of sections without files, and the check scripts). Each election states what it has in `sources` of
`src/elections.js` (`logs`, `rdv`, `open`, `official`, `pending` for layers still being imported); `src/elections.js` throws when `sources` disagrees
with `hasTimes`, `source.kind` or `hasResidual`, so the Sources panel of the overview and the badge under every view's title (which read that entry)
cannot claim a source the data does not use. Today: 2026 = logs + RDV (+ official totals), 2022 (both rounds) = the machines' logs + RDV (`rdv_machine`, `voting_times` of
`brazil-audit-2022`; the open data of the same database is only the reference of the official totals, and `sources.differences` documents the small
gaps against it: 58 foreign sections missing from the ZZ package and 13 sections with fewer ballots in round 1, 4 sections whose second urn has no RDV in
round 2; office 11, the mayors of the supplementary elections, is never selected), 2018 = open data only (the TSE published neither RDV nor logs). The
logs against the RDV (events = ballots per president section) are measured at build time (`--only=logmatch`) into `manifest.sources`.

### Maps and parliament

- `data/geo/*.json` are IBGE meshes (`servicodados.ibge.gov.br/api/v3/malhas`, `qualidade=minima`) turned at build time into
  compact SVG paths in one shared projection (`scripts/geo.mjs`) and deliberately approximate: Douglas-Peucker on the shared
  border arcs (0.03 degrees nationally, 0.004 per state; small arcs relative to their size) on a 1100/1400-unit integer grid.
  Sizes: Brazil by UF 13 KB, Brazil by municipality 403 KB (121 KB gzip, was 671 KB / 174 KB), the 27 state files 732 KB in total
  (280 KB gzip, was 2.3 MB), e.g. SP 23 KB over the wire. Everything is lazy: the UF map on its own, a state's municipalities
  when it is hovered/opened, the national municipality map only when chosen. Fernando de Noronha (outline from the single
  municipality mesh) is drawn magnified in the bottom-right corner of the national maps. Downloads are cached in `.cache/` (git-ignored)
  and throttled; the volatile TSE result files are refetched on every run.
- TSE municipality codes are not IBGE codes: `mun_map` joins them by (UF, name) using the `cdi` field of the TSE list;
  all 5,688 municipalities of 2026 and 5,709 of 2022 resolve (117 foreign cities have no polygon and are shown as "Exterior").
- The Parlamento view never recomputes seats (the Cadeiras view below does): senators carry the elected status per candidate; for deputies the TSE files give the seats per
  party/federation (`vag`: 513 federal, 1,035 state, 24 district), so the chambers are drawn by party or federation. The
  elected deputies per candidate (`e = 's'`) are only partly published yet and are listed in `elected` as they appear.
  In 2026 only 54 of the 81 Senate seats are up.

### Seat calculation (`/<election>/seats`)

Recomputes the deputy seats (federal, state, district; per UF, plus the federal chamber as the sum of the UFs) from the votes in the
database and shows every step: valid votes and seats, quociente eleitoral (also called coeficiente eleitoral / coeficiente de votação),
quociente partidário, the sobras by maior média round by round, the elected candidates and first alternates, and the comparison with the
official list. It works on whatever votes are loaded (so it projects a partial count; the residual switch adds the official totals of
sections without files) and every number can be reproduced in the SQL console (each panel's SQL, plus a pure-SQL check of the quotients).
`src/seats/calc.js` is the pure algorithm, `src/seats/rules.js` the rules as config (an election names its rule in `src/elections.js`:
`seatRule`; the page offers the others as what-if), `src/seats/load.js` the SQL, `test/seats.test.js` the unit tests (`npm run test:seats`, also part of `npm test`) and
`npm run verify:seats` (`scripts/verify-seats.mjs`) the comparison with the official result of every election, UF and office.

Rules (verified against the texts):

| Rule | Applies to | Sources |
|---|---|---|
| `coalitions2018`: coalitions are one list; candidate minimum 10% of QE; sobras by maior média among **all** parties and coalitions (not only those that reached the QE: Lei 13.488/2017 changed art. 109 §2 before 2018), first with a candidate of at least 10% of QE, then with no minimum; art. 111 if no list reaches the QE | 2018 | Código Eleitoral arts. 106-112 (planalto.gov.br/ccivil_03/leis/l4737compilado.htm); Lei 13.488/2017 art. 3; Res. TSE 23.554/2017 arts. 7-12 |
| `federations2022`: federations, no coalitions; candidate 10% of QE; sobras phase 1 only lists with 80% of QE and candidates with 20%; phase 2 still only lists with 80%, no candidate minimum; art. 111 | the 2022 proclamation, before the STF | Lei 14.211/2021 (art. 1: CE arts. 107-111); Res. TSE 23.677/2021 original arts. 11-13 |
| `stf2024`: as above, but phase 2 is open to every list and candidate; art. 111 struck down (no list reaches the QE: all seats by maior média, 80%/20% first) | 2022 as recalculated, and 2026 | STF ADIs 7228, 7263, 7325 (2024-02-28: from 2024 on; embargos 2025-03-13: from 2022 on, quorum of art. 27 of Lei 9.868/1999); Res. TSE 23.677 arts. 11 and 12-A as worded by Res. 23.734/2024 and 23.748/2026 |

The QE rounds half down (a fraction up to 0.5 is dropped, above it rounds up, CE art. 106); the QP drops the fraction; ties of averages go to
the list with more votes, then to the candidate with more votes (Res. 23.677 art. 11 §6-7); the average counts every seat the list holds,
also the ones released by the 10% minimum (ADI 5420; Res. 23.677 art. 11 §5). Valid votes are the nominal votes of candidates whose votes the
official result counts plus the legend votes; blank, null and annulled votes (Res. 23.677 arts. 20-22: annulled sub judice, rejected before
the election) are out; the votes of a candidate rejected after the election count for the list's legend (art. 20 §2).

Data added (about 170 KB gzip in total): `lineup` (one row per party list: bloc, valid legend votes, official valid votes; 2018/2022 from the
TSE open data `votacao_partido_munzona`, 2026 from the state files + RDV legend votes with an official residual), `annulled` (candidate
numbers whose votes the official result does not count) and the deputies of 2018/2022 in `elected`. The 2026 `elected`/`seats` were
rebuilt: the earlier dump listed only 1,161 of the 1,572 elected deputies (the TSE had not totalized every UF yet). `node scripts/build-data.mjs --only=lineup`
(and `--only=elected`) regenerate them.

Verification (`npm run verify:seats`, the shipped dump, each UF and office with its own rule):

| Election | Rule | UF/offices | Same elected as official | Valid votes = official | QE = TSE QE |
|---|---|---|---|---|---|
| 2018 | coalitions2018 | 54 (27 federal, 26 state, DF district) | 54 | 54 | n/a |
| 2022 | stf2024 | 54 | 54 | 54 | n/a |
| 2026 | stf2024 | 54 | 54 | 54 | 54 |

What the verification showed (and what it does not):
- The 2022 official list in the dump is the one **after** the STF recalculation (the collector ran after March 2025): the as-proclaimed
  rule `federations2022` differs from it in exactly AP, DF, RO and TO (federal), as reported by the press. DF (Gilvan Maximo out, Rodrigo
  Rollemberg in) and RO (Lebrão out, Rafael Fera in) are reproduced with the names of the press; the 2025 list for TO (press: Lázaro Botelho
  out, Tiago Dimas in) and AP (press: Silvia Waiapi, Sonize Barbosa, Professora Goreth, Augusto Pupio out) is **not** reproduced by
  `federations2022` on today's votes: in AP the PL candidates were annulled after the election (the votes of the original proclamation are
  no longer in the data), and in TO the rule gives the last seat to UNIÃO (Dra. Angela da Facit) rather than to PP, so the TSE's original
  implementation of the second stage must differ in a detail the texts do not settle. `federations2022` is therefore a what-if on today's votes, not a reconstruction of the 2022 night.
- The unmodified collector data does **not** reproduce the official result: the RDV votes also count candidates rejected before the
  election (the urns still had them; official: null votes), numbers of candidates withdrawn after the urns were loaded, and votes that the TSE
  converts to legend for candidates rejected after the election. Using the official valid votes per party and the candidate validity of the
  official result (tables `lineup`, `annulled`) removes all of that; the first runs without them had 3 to 9 UF/office mismatches per election
  (e.g. MG federal 2022: PODE needs the 29,923 votes of candidate 1911, rejected after the election, as legend votes to take its second seat).
- 2026 projection from the sections in the dump (switch the residual off): every UF/office still gives the official elected list;
  the 773 sections (699 outside the abroad vote) missing in the dump are covered by the residual. A real partial count is as good as its closest
  margin: the last column of the national table shows the votes the next list lacked for the last seat of each UF.
- Ties between candidates with the same votes are broken by candidate number (the age of the CE art. 110 is not in the data); no tie occurs at a seat boundary (candidates or averages) in the three elections.

### Votes of sections without files (`residual`)

Sections whose files the TSE never published are missing from the dump, but the official result files count them. Step `residual`
of `scripts/build-data.mjs` (shared helpers in `scripts/official.mjs`) takes, for every zone that has missing sections, the official
zone file (`.../dados/<uf>/<uf><city code>-z<zone>-c000N-e00…-u.json`) and stores official minus what the shipped parts hold, per
(UF, municipality, zone, office, candidate number, `branco`, `nulo`); the municipality figure used by the national/UF/city totals is
the sum of its zones. Files are cached 12 h and fetched at ~4 requests/s. Nothing is invented: the zone residuals are used only if
they add up exactly to the residual computed from the official city file (zone and city files are published at different
moments); otherwise that city/office uses the city-level residual (`zone` empty) and the disagreement is listed in
`residual_skipped`; a city/office whose official files are not fully totalized, unreadable or give a negative residual gets none.
Results, totals and coverage are derived from the shipped rdv parts (never from the database), so rollups, sections and residual
always describe the same snapshot.

The app has a switch "Incluir votos de seções sem arquivo" (on by default for 2026, `?residual=0` turns it off) that adds the
residual to the national, UF and city totals (Overview, Mapas, the UF/city drill-down); zones, sections and every section-based
analysis never include it. The zone list of a city shows, after each zone with missing sections, a marked row with that zone's
residual (so each zone adds up to the official zone file) and, at the end, zones with no section file at all and any city-level
fallback row. `node scripts/verify-official.mjs` compares the shipped totals with the official UF, national and zone files: every
candidate and the blank votes match in 137 of 137 UF/office pairs and 140 of 140 zone/office pairs.

Null ballots are counted as RDV kinds 4 (invalid number), 6 and 7 (the second senate vote). They then equal the official null total
in all but three UF/office pairs (pb/6 304, se/6 435, sp/6 803 votes of 117,898/65,428/1,128,132 etc.): the official total adds
"technical nulls" (`vnt`) that the RDV does not carry as such; the numbers the TSE lists as invalid but the RDV has as nominal
(votes for numbers without candidate, shown as "Outros / inválidos") explain most of it, the remainder is not identifiable per section.

### Coverage of 2026

499,248 sections have own files and results (the TSE total, 100% totalized). Another 17,931 sections are *aggregated*
(`nsp != ns` in the TSE state configs): their votes are counted in the main section and they have no files of their
own, so they are never counted as missing. The dump stores 499,206 of the 499,248 sections (99.99%); the other 42 (41 abroad whose machine
was not installed, 1 in MA published with a bulletin but no RDV) are listed in `miss` (shown in the overview). The 31 sections
of MG published as `logsa`/`rdv.dat` have votes but no vote events in their log, so no voting times. Kinds in the RDV: 2 nominal,
3 blank, 4 invalid number, 6 null (the TSE site counts 4 and 6 as null; kinds 1 and 7 are not shipped). Candidate numbers
that are not in the TSE candidate list appear as nominal in the RDV but are shown as "Outros / inválidos".

### Regenerate

```sh
nice -n 10 npm run data                              # all elections, all UFs (~11 min on a loaded machine, mostly the 2026 voting times)
nice -n 10 node scripts/build-data.mjs --election=2018,2018-2,2022,2022-2 --only=rdv,results   # the open-data elections: about 2 minutes
node scripts/verify-open.mjs --election=2022-2       # elected candidates vs the official totals in the source database
nice -n 10 node scripts/build-data.mjs --election=2026 --only=rdv,vt --states=ac,ro
```

`scripts/build-data.mjs` reads the local databases `brazil-audit-2026` (the 2026 collector) and `brazil-audit-2018` / `brazil-audit-2022`
(the collector of branch `2018`: the open data in `rdv_votes`, `section_detail`, `candidates`, `elected`; for 2022 also the machines' own `rdv_machine` and `voting_times`; both rounds) read-only through `psql`
and fetches candidate names and the section configs from the TSE (no CORS, hence build time). Everything is computed
inside Postgres per state: results dumps, the voting-time buckets and gap statistics, and the rollups. `voting_times` is
never scanned: it is probed once per section through its index (`state, city, zone, section, model, post` prefix).
Options `--only=votes|rdv|vt|rollups|results|cands`, `--states=`. Commit the result; the manifest `version`
invalidates browser caches.

### Voting-time encoding (full 2026: 499,149 sections, 24 MB gz)

- Only `post = 'Presidente'` (one event per voter; the Senate post has about two).
- Times are the **local clock as recorded** (AC opens 06:00, RO/RR/AM/MT/MS 07:00, rest 08:00). Buckets start at 05:00
  local, 10 minutes each, 90 buckets (05:00-20:00), tails clamped into the edge buckets. The UI converts to Brasília time at query
  time by shifting bucket indexes with `vtc.tz` (6 buckets per hour). `tz` is estimated per city from its earliest
  first vote (08:00 BRT) and capped at the state's most common value, which also catches western Amazonas (UTC-5).
  Fernando de Noronha (UTC-2, polls open at 09:00 on its clock) is fixed to +1 in the build script.
- About 48 B per section with its keys (gzip CSV). 10-minute buckets cannot detect too-fast voting; the gap
  statistics can (the benchmark found 40/40 synthetic anomalies with 0 false positives).
- Country/state charts read the 5,688-row city rollups (0.6 MB gz), never the section table.

### Load times measured (Chrome 154 headless, loopback, loaded machine)

First visit on a fresh origin: 2026 overview ready in 2.4 s (1.1 s warm), 2022 overview with all 472k rows imported in 5.7 s.
Heaviest views (SP): UF listing 0.9 s, municipality listing 2 s, zone listing +1.5 s (imports the 5 MB main part), city
deputies 3 s after importing `sp.6` (4-9 s), one section with the full ballot 10 s (imports the main part plus both deputy
parts, 28 MB gz), voting-time pace table 1 s. PGlite has no autovacuum, so every import is followed by `ANALYZE`
(without it the `cands` joins used nested loops and a zone listing took 18 s instead of 80 ms).

## Engine notes

- `src/db/index.js` is the only module that touches the engine: `query(sql, params) → {columns, rows, ms}` (params are
  bound server-side as `$1…`; add `::text` to a parameter whose first use is `IS NULL`) and a reactive `engine` status.
  Changing engine means reimplementing that file and `src/db/pglite.worker.js`.
- PGlite starts with initdb (~1-2 s) and keeps the database in IndexedDB (`idb://auditoria`), so imported parts survive
  reloads; compressed downloads are also kept in the Cache API. "limpar dados locais" wipes both.
- PGlite uses the `C.UTF-8` locale: `ILIKE` folds accents but `ORDER BY` is codepoint order. Text sorting in the UI
  uses `collate()` from `src/model.js` (a `translate()` key that folds Portuguese accents) inside SQL, so pagination
  stays SQL-driven.
- Vapor mode compiles Pug templates fine through `@vitejs/plugin-vue` (`vue({ features: { vapor: true } })`, SFCs use
  `<script setup vapor>`). Quirks: Vue 3.6 prereleases do not satisfy `@vitejs/plugin-vue`'s peer range, hence
  `.npmrc` `legacy-peer-deps`; dev-mode HMR logs `Cannot read properties of null (reading 'anchor')` and needs a manual
  reload; `<select :value>` must be set with `:selected` on dynamically rendered options.

## Dados brutos

The raw TSE files behind the dump (`aux.json`, the RDV and the logs of 2022 and 2026) are published as GitHub release
assets of [`brauliobo/brazil-audit`](https://github.com/brauliobo/brazil-audit/releases), tags `data-2026` and
`data-2022`. GitHub does not take 1.5 million loose files, so each asset is an independent zip of one state and one kind
of file, below 1.8 GiB (a big state has several), named `<year>-<kind>-<uf>-NN.zip`:

| kind | content |
|---|---|
| `aux` | per section `aux.json` and the state config |
| `rdv` | per section RDV (results per ballot office) |
| `logs` | per section voting logs (the source of the voting times) |

Entries keep their cache path (`ballots/…`, `files/…`, `states/…`), so unzipping inside a data dir restores it. Each
release also has `MANIFEST.tsv` (files and bytes per asset), `SHA256SUMS` and `INDEX.json` (`{year, repo, tag, assets: [{name, kind, uf, first, last, files, bytes}]}`:
the first and last entry key of each asset, so the zip that holds a section is found by comparing strings).

The app shows these links for a section ("Dados brutos desta seção": the rdv, logs and aux zips holding the section's files, the `unzip -p`
command that extracts them, the release page, the live TSE `aux.json` address for 2026, and the collector's code in its branch) and a lighter
line at city, zone and election level. A browser cannot read GitHub release URLs (no CORS), so `scripts/build-data.mjs --only=raw` ships
the compacted index under `data/raw/<election>.json` (downloaded from the release, or from `RAW_INDEX_DIR=/srv/release-staging` with
`meta-<year>/INDEX.json`; a missing index fails the build) and the TSE city code is a column of `mun_map`. `node scripts/check-raw.mjs
--election=2026` resolves 500 random sections of the dump and, when the zips are on disk, checks that the files are inside the zip it points to.
The 2022 runoff uses the release `data-2022` (RDV and logs of the first version of the site); 2018 and the 2022 first round come from the TSE
open data (per-state CSV files) collected by branch `2018`, and have no per-section files, only the collector link.

```sh
gh release download data-2026 -R brauliobo/brazil-audit -p '2026-rdv-sp-*' -p SHA256SUMS
sha256sum -c SHA256SUMS --ignore-missing
unzip 2026-rdv-sp-01.zip                  # or a single file: unzip 2026-rdv-sp-01.zip files/<name>
```

## Licenses

The application code is MIT licensed (`LICENSE`, Copyright (c) 2026 brauliobo). PGlite is Apache-2.0 (PostgreSQL itself
is under the PostgreSQL License). The election data are TSE open data (https://dadosabertos.tse.jus.br, licence Creative Commons Attribution, CC BY); the municipal geometry is IBGE's.
