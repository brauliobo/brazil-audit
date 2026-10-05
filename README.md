# Brazil election audit: 2026 collector

Downloads the TSE voting-machine files of every section (info, log and RDV) and stores the votes and the voting times in
PostgreSQL. The 2022 data lives in the `2022` branch, and the analysis app in `main`.

## Run

```
createdb brazil-audit-2026
PROXIES=~/.config/auditoria/proxies.txt bin/run-2026
```

`PROXIES` is a file with one `host port user pass` per line (never committed). Each request picks one at random and
rate limits (429, 466) are retried through another one.

| Env | |
|---|---|
| `YEAR` | `2026` (default), `2024` or `2022`; each year has its own dir and database |
| `PROXIES` | proxies file; without it requests go out directly |
| `THREADS` | threads per level (state, city, zone, section, hash) |
| `PHASE` | `fetch` or `store` to run only one step (default: both, per section) |
| `STATES`, `CITY` | restrict the run, e.g. `STATES="to sp" CITY="AURORA DO TOCANTINS"` |
| `DB_NAME` | database name (default `brazil-audit-<year>`) |
| `RDV_SKIP` | do not download the RDV files |

## How it works

Every section reloads its missing files (fetch) and then stores its votes (store) in one transaction; a mark in
`2026/stored/<database>/` tells a resume what is already stored. Cities the official results do not count as totalized
yet are skipped, so a pass only downloads what the TSE already published.

| Table | |
|---|---|
| `rdv_votes` | one row per section and office; `votes` is `{ kind => { number => votes } }` (jsonb) |
| `voting_times` | one row per confirmed vote: section, office (`post`) and time |

Offices: 1 president, 3 governor, 5 senator, 6 federal deputy, 7 state deputy, 8 district deputy.
Kinds: 2 nominal, 3 blank, 4 invalid number; 1 and 7 are stored as they come.

Code is in `lib/`, one responsibility per file.

## Coverage

The TSE counts 499,248 sections with votes. The state configs list 517,179 because 17,931 are aggregated sections (`nsp`
differs from `ns`): their votes are counted in the main section and they have no files of their own, so they are skipped
(`bin/pending` counts what is still missing). When the collector was stopped, 1,800 sections with files of their own had
no info file published yet and 641 had one without the log or the RDV, so about 99.5% of the sections are stored.

## Raw data

The raw TSE files are not in git (GitHub does not take 1.5 million files, nor 120 GB), they are release assets of this
repository. Each asset is an independent zip, below 1.8 GiB, of one state and one kind of file; a big state has several:

| Release | Assets |
|---|---|
| `data-2026` | `2026-aux-<uf>-NN.zip` (info files and the state config), `2026-rdv-<uf>-NN.zip` (votes), `2026-logs-<uf>-NN.zip` |
| `data-2022` | the same names with `2022` (president, 2nd round) |

Entries keep their cache path (`ballots/…`, `files/…`, `states/…`), so unzipping inside the data dir restores it. Each
release also has `MANIFEST.tsv` (files and bytes per asset) and `SHA256SUMS`.

```
gh release download data-2026 -R brauliobo/brazil-audit -p '2026-rdv-sp-*' -p SHA256SUMS
sha256sum -c SHA256SUMS --ignore-missing
unzip 2026-rdv-sp-01.zip                        # or a single file: unzip 2026-rdv-sp-01.zip files/<name>
```

The analysis app and its data dump are in the `main` branch (https://brauliobo.github.io/brazil-audit/), the original
2022 script in the `2022` branch.

## License

MIT, see `LICENSE`. The data are public TSE files.
