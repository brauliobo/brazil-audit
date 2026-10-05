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
  user page or custom domain. Routing is hash based (`#/2026/time/ba`), and `404.html` is a copy of `index.html`.
- `.github/workflows/pages.yml` runs `npm ci`, `npm run build` and deploys `dist` with the official Pages actions. Enable
  Pages with source "GitHub Actions" in the repository settings. Nothing is downloaded at build time.
- Pages limits: 1 GB site, 100 MB per file. Largest file is the 9.6 MB `pglite.wasm`; the data parts are 13 KB - 4.4 MB.

## Data (`data/`)

`data/manifest.json` lists tables, DDL, columns and parts (url, rows, bytes, and for split tables the `where` that
identifies a part). Parts are gzip CSV, loaded lazily with `COPY ... FROM '/dev/blob'` (inflated with
`DecompressionStream`, so there is no extra JS dependency). Brotli is not usable: browsers cannot decode it from JS and
Pages does not serve `.br`. The whole `data/` is 137 MB (2022: 2.9 MB, 2026: 134 MB); no file exceeds 12.4 MB.

| table | content | parts |
|---|---|---|
| `votes_2022` | 2022 runoff, votes for 13 and 22 per section (472,027 rows) | 28 UFs |
| `rdv_2026` | per section and office: `nominal`/`blank`/`nul` totals and `votes jsonb` ({candidate: count}, nominal only). 2,478,962 rows | per UF: `uf` (president, governor, senator) plus `uf.6`, `uf.7` (`uf.8` for DF), 82 parts, 112 MB gz |
| `vt_2026` | per section, post Presidente: events `n`, `first`, `last`, gap stats `med`/`p10`/`p90`/`maxgap` (s), `b smallint[90]` 10-minute buckets (496,788 rows) | 28 UFs, 24 MB gz |
| `vtc_2026` | per city rollup of `b` plus `tz`, the estimated clock offset vs Brasília | 1 file |
| `tot_2026`, `res_2026` | rollups: per city/office totals; votes per candidate (per city for president/governor/senator, per UF for deputies) | 1 file each, 1.2 MB gz |
| `cov_2026`, `miss_2026` | coverage per UF and the list of sections without results | 1 file each |
| `mun_map` | (UF, municipality name) → IBGE code, from the TSE municipality list (`cd`/`cdi`), plus 2022 spellings; foreign cities have no code | 1 file |
| `seats_2026` | seats per party/federation, UF and office, from the official TSE state files | 1 file |
| `elected_2026` | elected candidates published by the TSE (uf, office, number, name, party, status, votes) | 1 file |
| `cands` | candidate names/parties/official totals (TSE files) for 2022 and 2026 | 1 file |

SQL views `sec_<year>`/`cs_<year>` (section grain) and `tot_<year>`/`res_<year>` (city grain, views over the sections for
2022) give both elections the same shape (see `src/model.js`). The overview and the UF/município listings read only the
small rollups; zones, sections, analysis and the pace table load the section parts of the UF (and, for deputies, of the
office) on demand.

### Maps and parliament

- `data/geo/*.json` are IBGE meshes (`servicodados.ibge.gov.br/api/v3/malhas`, `qualidade=minima` for Brazil by state and by
  municipality, `intermediaria` for the 27 state files) converted at build time into compact SVG paths in one shared
  projection (`scripts/geo.mjs`): 3.0 MB in total, loaded lazily (states 20 KB, municipalities 670 KB, one state 18-290 KB).
  Fernando de Noronha and the oceanic islands are clipped from the drawing. Downloads are cached in `.cache/` (git-ignored)
  and throttled; the volatile TSE result files are refetched on every run.
- TSE municipality codes are not IBGE codes: `mun_map` joins them by (UF, name) using the `cdi` field of the TSE list;
  all 5,688 municipalities of 2026 and 5,709 of 2022 resolve (117 foreign cities have no polygon and are shown as "Exterior").
- Seats are never recomputed: senators carry the elected status per candidate; for deputies the TSE files give the seats per
  party/federation (`vag`: 513 federal, 1,035 state, 24 district), so the chambers are drawn by party or federation. The
  elected deputies per candidate (`e = 's'`) are only partly published yet and are listed in `elected_2026` as they appear.
  In 2026 only 54 of the 81 Senate seats are up.

### Coverage of 2026

499,248 sections have own files and results (the TSE total, 100% totalized). Another 17,931 sections are *aggregated*
(`nsp != ns` in the TSE state configs): their votes are counted in the main section and they have no files of their
own, so they are never counted as missing. The dump stores 496,814 of the 499,248 sections (99.5%); the other 2,434 had
no `aux.json`/RDV published by the TSE and are listed in `miss_2026` (shown in the overview). Kinds in the RDV: 2 nominal,
3 blank, 4 invalid number, 6 null (the TSE site counts 4 and 6 as null; kinds 1 and 7 are not shipped). Candidate numbers
that are not in the TSE candidate list appear as nominal in the RDV but are shown as "Outros / inválidos".

### Regenerate

```sh
nice -n 10 npm run data                              # both elections, all states (~17 min for 2026 on a loaded machine)
nice -n 10 node scripts/build-data.mjs --election=2026 --only=rdv,vt --states=ac,ro
```

`scripts/build-data.mjs` reads the local databases `brazil-audit` and `brazil-audit-2026` read-only through `psql`
and fetches candidate names and the section configs from the TSE (no CORS, hence build time). Everything is computed
inside Postgres per state: results dumps, the voting-time buckets and gap statistics, and the rollups. `voting_times` is
never scanned: it is probed once per section through its index (`state, city, zone, section, model, post` prefix).
Options `--only=votes|rdv|vt|rollups|results|cands`, `--states=`. Commit the result; the manifest `version`
invalidates browser caches.

### Voting-time encoding (full 2026: 496,788 sections, 24 MB gz)

- Only `post = 'Presidente'` (one event per voter; the Senate post has about two).
- Times are the **local clock as recorded** (AC opens 06:00, RO/RR/AM/MT/MS 07:00, rest 08:00). Buckets start at 05:00
  local, 10 minutes each, 90 buckets (05:00-20:00), tails clamped into the edge buckets. The UI converts to Brasília time at query
  time by shifting bucket indexes with `vtc_2026.tz` (6 buckets per hour). `tz` is estimated per city from its earliest
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
release also has `MANIFEST.tsv` (files and bytes per asset) and `SHA256SUMS`.

```sh
gh release download data-2026 -R brauliobo/brazil-audit -p '2026-rdv-sp-*' -p SHA256SUMS
sha256sum -c SHA256SUMS --ignore-missing
unzip 2026-rdv-sp-01.zip                  # or a single file: unzip 2026-rdv-sp-01.zip files/<name>
```

## Licenses

The application code is MIT licensed (`LICENSE`, Copyright (c) 2026 brauliobo). PGlite is Apache-2.0 (PostgreSQL itself
is under the PostgreSQL License). The election data are TSE public data.
