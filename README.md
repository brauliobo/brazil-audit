# Brazil election audit: open data collector (2018 and 2022)

Downloads the TSE open data of a general election (`YEAR=2018`, the default, or `YEAR=2022`: president, governor, senator,
federal, state and district deputy; both rounds) and imports the votes of every section into PostgreSQL, in the same shape
as the 2026 collector. This branch (`2018`) is the collector of both years. The runoff of the president of 2022 from the
portal RDV files is in the `2022` branch and the `data-2022` release, the 2026 collector in `2026` and the analysis app in
`main`.

`bin/collect-2018` is now `bin/collect` (`YEAR=2018` is the default, so the old command line still works with the new name).

## What exists and what does not

The voting machine files (RDV, logs, BU of the urns) of **2018 are not published**: the results portal and the `arqurnatot`
package answer 404. So there are **no RDV, no logs and no voting times** (the time of each vote) in 2018. Those of **2022 are
published** in per-state packages (`arqurnatot/bu_imgbu_logjez_rdv_vscmr_2022_<1t|2t>_<UF>.zip`, 157 GiB for the 56, 24
of them over 2 GiB) and are collected as described in "Voting machine data (2022)". What the TSE publishes as open data is
enough for the votes of every section and, from the boletim de urna CSVs, the time each section opened and closed its voting.

| Source | What it gives |
|---|---|
| `votacao_secao` (27 states + `BR`) | votes per section, turn, office and candidate/party/blank/null; `BR` is the president in all states, foreign vote (ZZ) included |
| `detalhe_votacao_secao` | turnout of each section and office (eligible, turnout, abstention, nominal, blank, null, legend), polling place, when the TSE received the BU |
| `bweb_*` (boletim de urna CSV) | per section and turn: urn number, flash card and load, opening and closing times, aggregated sections, biometric voters |
| `CEFT_*` (correspondência efetivada) | per section and turn: the urn expected and the one used (divergence), origin of the vote (urn, RED, totalization) |
| `consulta_cand` | the registry of candidates (coalitions and, in 2022, federations) |
| `votacao_candidato_munzona` | votes per candidate, municipality and zone, with the outcome (`ELEITO`, `2º TURNO`, ...) |

Also downloaded and kept raw, nothing is imported from them: `detalhe_votacao_munzona`, `votacao_partido_munzona`,
`consulta_cand_complementar`, `consulta_coligacao`, `consulta_vagas`, `motivo_cassacao`, `eleitorado_local_votacao` and
`perfil_eleitor_secao` (electorate profile per section); and, in 2022 only, `secoes_agregadas`,
`perfil_comparecimento_abstencao`, `Historico_Totalizacao_Presidente_BR_{1T,2T}` (the totalization of the president minute
by minute) and `lista_eleicoes_suplementares`. Each zip has its `leiame.pdf` with the layout.

The sections are the principal ones: the aggregated sections (`aggregated` in `section_urn`) vote in the urn of another one
and have no rows of their own. The times in the BU CSVs are local time of the section.

## Run

```
createdb brazil-audit-2018        # or brazil-audit-2022
bin/collect                       # YEAR=2022 bin/collect
```

It downloads the zips into `<year>/raw/` (once each, with resume and a size check) and imports them. The tables are created
on the first run. A resume downloads what `<year>/raw/MANIFEST.tsv` does not list and imports the files not in `imports`.

| Env | |
|---|---|
| `YEAR` | `2018` (default) or `2022`: the election codes are in `lib/config.rb`, the names of the files that differ in `lib/sources.rb` |
| `WORKERS` | parallel downloads and imports, 1 to 3 (default and maximum 3) |
| `PHASE` | `fetch` or `import` to run only one step (default: both) |
| `STATES` | import only these units, e.g. `STATES="AC BR ZZ"` (default: the 27 states, `BR` and `ZZ`) |
| `DB_NAME` | database (default `brazil-audit-<year>`) |

It runs at low CPU and disk priority (`nice`, `ionice`). Needs PostgreSQL, `curl`, `unzip` and `sed`.

Tests (they create and drop a scratch database; they need the zips in `<year>/raw`, and in `2022/rdvlog` for the machine data):

```
YEAR=2022 ruby test/import_test.rb      # imports AC and checks the invariants of the import
ruby test/machine_test.rb               # the RDV and logs of AC, both rounds, against the open data
ruby test/remote_zip_test.rb            # reads a few entries of a package of the CDN with Range requests (3 MB)
test/verify 2022                        # the checks on the whole database, printed (see Coverage and checks)
psql -d brazil-audit-2022 -f test/verify_machine.sql   # the checks of the machine data
test/verify_legacy                      # the runoff of the president against the legacy `votes` table
```

## How it works

`lib/sources.rb` lists the files, `lib/download.rb` fetches each one and `lib/manifest.rb` records it. The CDN answers a
`Content-Length` of 1 to HEAD and none to some GETs while a file is not cached, so the size is checked after the download
with a 1 byte range request (`Content-Range`, or the `Content-Length` of the servers that ignore the range), and a file is
only listed in the manifest when its size matches.

The importer streams each CSV out of its zip (`unzip -p`) into an UNLOGGED staging table with `COPY` (`LATIN1`, `;`,
`#NULO#` as NULL), aggregates it in SQL into the final table and drops the staging table, all in one transaction that also
writes the row of the file in `imports` (rows read, rows loaded, votes, unclassified and skipped rows). Rows never go
through Ruby. The `*_BRASIL.csv` of the zips is every state again and is skipped; the foreign sections are in the `BR` file
(2018: also an empty `ZZ` file in `detalhe_votacao_secao`).

Only the general election is imported (`ELECTIONS` in `lib/config.rb`: `cd_eleicao` 295 to 298 in 2018, 544 to 547 in 2022;
federal in the 1st and 2nd round, then the state ones). The files have other elections, whose rows are skipped and counted in
`imports.skipped`: in 2018 the Mato Grosso supplementary senator (15 November 2020), with the same turn and office as the
general one, and local plebiscites in the urn files; in 2022 the Roraima supplementary governor (a vote of 21 June 2026, in
files published in 2022!) and the Fernando de Noronha district council (548).

The TSE does not escape the quotes inside a field (`ALICE SANT"ANA`, `PROF, JADSON MACEDO "JAJÁ"`): `COPY` would take them
as the end of the field and merge thousands of rows without any error (the first round BU of Bahia in 2018 lost 45% of its
rows). So the quotes around the fields are taken out on the way in (`sed`), `COPY` reads the lines split by `;`, and an
import fails when the rows read differ from the lines of the CSV. The same `sed` writes `#NULO` (the candidates of 2022) as
`#NULO#`; the BU files of 2018 spell `flashcard` wrong, normalized to the 2022 spelling.

`rdv_votes` has the votes as cast: those of the candidates whose candidacy was rejected (`INAPTO`) are there, while
`votacao_candidato_munzona` (so `elected`) and the zone totals of `detalhe_votacao_munzona` leave them out or count them as
null. It is 0.9% of the nominal votes in 2018 and 0.4% in 2022.

## Tables

States are lowercase (`zz` is the foreign vote, `br` the president in `candidates` and `elected`), zones and sections are
zero padded to 4 digits, `city_code` is the 5 digit TSE code. The key of a section is `(state, city_code, zone, section)`.

| Table | Key | |
|---|---|---|
| `rdv_votes` | section, turn, office | `votes` is `{ kind => { number => votes } }` (jsonb) |
| `section_detail` | section, turn, office | turnout and kinds of votes, polling place, when the BU was received |
| `section_urn` | section, turn | urn, votes recorded in it, flash card, loads, aggregated sections, opening and closing, biometric voters |
| `urn_match` | section, turn | urn expected and used, origin and divergence |
| `candidates` | `sq_candidato`, turn | number, names, party, coalition (a federation in 2022), status, outcome, gender, race, education, occupation |
| `elected` | `sq_candidato`, turn | votes per candidate and turn (summed over municipalities and zones), party, outcome |
| `imports` | file | what each file read and loaded |

Offices: 1 president, 2 vice-president, 3 governor, 4 vice-governor, 5 senator, 6 federal deputy, 7 state deputy,
8 district deputy (9 and 10 are the substitutes of the senators, only in `candidates`). Only 1, 3, 5, 6, 7 and 8 have votes.

Kinds of `rdv_votes`, the same as 2026 plus one:

| Kind | Key | Votes |
|---|---|---|
| 2 | candidate number | nominal |
| 3 | `''` | blank (`NR_VOTAVEL` 95) |
| 4 | `''` | null (96) |
| 1 | party number | legend, only in the deputy offices, where only parties have 2 digit numbers |
| 5 | `''` | annulled and counted apart (97): 2018 only, in two sections of Salvador (BA, zone 18, sections 202 and 328), 1st round |

A row is counted as unclassified when its number says nominal but its `sq_candidato` is not a candidate, or the other way
round; `imports.unclassified` has the count of each file (0 in both years).

## Voting machine data (2022)

The RDV (the votes of the section as the urn recorded them) and the log (with a line for each confirmed vote, so the time of
each vote) of 2022, both rounds, go to the same database as the open data, in the same shape as the 2026 collector plus a
`turn` and the TSE city code:

| Table | Key | |
|---|---|---|
| `rdv_machine` | section, turn, office | `votes` is `{ kind => { number => votes } }` (jsonb) of the RDV, and the `model` of the urn (`UE2009` to `UE2020`) from its log |
| `voting_times` | (not unique) | one row per confirmed vote: section, `model`, `turn`, `post` (the office name) and `time` (local time) |
| `machine_sections` | section, turn | what each section had: RDV and log files, ballots, events, events of other days, lines of a vote that did not match, first and last vote |

`rdv_machine` does not take the name `rdv_votes` because that is the table of the open data; the two are compared by
`test/verify_machine.sql`. `voting_times` keeps the votes of the same second (the 2026 table collapses them: its key has the
time), so a section has exactly the events of its log. The units imported (a round, a state and a zone) are in `imports` as
`machine/<turn>t/<uf>/<zone>`.

**First round** (`PHASE=rdvlog`): the 56 packages (70 GiB the 28 of the first round) are mostly the BU, its image and the vote
summary, which are not needed. `RemoteZip` reads the central directory of each package with HTTP Range requests and then only
the `.rdv` and `.logjez`/`.logsajez` entries, many ranges in one request (the CDN answers `multipart/byteranges`), inflating
and checking the CRC and the size of every one; `RdvlogPack` writes them as independent zips by state, below 2 GiB
(`2022/rdvlog/2022-1t-rdv-logs-<uf>-NN.zip`), with `2022/rdvlog/MANIFEST.tsv` (name, bytes, sha256, source URL, entries); a
resume skips the entries of the finished parts. About 35 GiB were transferred, half of the packages. A package the CDN has not
cached (ZZ, round 1) answers a Range request with the whole file and no length: it is read once, up to 512 MiB, to cache it.

**Second round** is read from the raw files of the portal collector (`MACHINE[:legacy]`, the `files/` of the `2022` branch, in
the `data-2022` release), not copied from its `votes` table: `test/verify_legacy` compares them (`votes_13`, `votes_22`).

`PHASE=machine` parses with the code of the 2026 collector (`lib/rdv.rb`, the log of `lib/voting_log.rb`: 7z archives with
`logd.dat`, the line `Voto confirmado para [post]`) in 3 processes. What differs in 2022, all counted, none skipped silently:

- a log has the events of the other round and of the tests of the urn (the urn of the second round has the first round in its
  log): only those of the day of the round (`MACHINE[:days]`) are stored, the others are `imports.skipped` and
  `machine_sections.other_days`;
- a section can have two logs (`.logjez` and `.logsajez`, a second urn, which the BU calls `.busa`), whose events are all stored;
  41 sections have a `.logsajez` and no `.logjez`; 5 have an RDV and no log; in the files of the portal one section has two RDVs
  (two hashes), of which only the first is stored (counted in `skipped`);
- the RDV has the kind 6 (a null vote with no number, that the open data counts as null) besides the kinds of 2026, and keeps the
  digits typed in the legend votes (kind 1), where the open data has the party (the first 2 digits) and in the null votes
  (kind 4), where it has no number.

Checked by `test/verify_machine.sql` (the numbers of the import of 2022, 943,997 sections, 803,025,812 voting times, 3,077,938
section and office rows of `rdv_machine`):

- **RDV vs the open data** (`rdv_votes`), by section, turn and office, the nominal and legend votes by number (the legend by
  the first 2 digits typed) and the blank and null by total: 3,077,003 of 3,077,938 section and office rows are identical.
  The other 935 are 13 sections (round 1: 3 in AM, 2 in SP, 2 in ZZ, one in BA, MG, MT, PE, PR and RS; round 2: BA, DF, RS and SC)
  where the RDV has fewer ballots than the open data (the voters of a second urn, which the BU has as `.busa` and has no RDV,
  are counted apart: 1 to 275 votes per section), and 871 section and office rows of the office 11 (mayor, supplementary
  elections of the same day in 5 states), that the open data does not have;
- **runoff of the president vs the legacy `votes`** (`test/verify_legacy`): 472,027 sections, 472,023 identical (the 60,345,999
  and 58,206,354 of the legacy table against 60,345,934 and 58,206,113 of the RDV); the 4 others are 4 of those sections
  of a second urn, where the legacy values are the ones of the open data. The legacy `voting_times` is empty;
- **log vs RDV**: the confirmed votes of the log equal the ballots of the RDV in 423,045 of 471,710 sections in the president of
  round 1 (89.7%) and 460,830 of 471,883 in round 2 (97.7%); the rest have fewer events (a section whose urn was replaced during
  the voting has the log of one urn, for instance 15 events for 213 ballots), except 221 and 215 with more; 0 lines of a confirmed vote did not match;
- **files**: 2 sections of round 1 have an RDV and no log, 2 a log and no RDV; 5 sections of round 2 have an RDV and no log; 256
  and 139 sections have a log with no vote of the day; the open data has 58 foreign sections of round 1 that the package of ZZ
  does not have (and the foreign section with no vote of round 2);
- **times**: the first vote is inside the opening of the section (`section_urn`) in all but 2 sections of round 1 (20 minutes
  before) and the last one is never after the closing; 267 and 151 sections have no opening to compare.

## Coverage and checks

`test/verify <year>` prints them; all of them passed the same way in both years. The numbers of each year:

| | 2018 | 2022 |
|---|---|---|
| Sections (principal) / zones / municipalities | 454,490 / 6,273 / 5,741 | 472,075 / 6,283 / 5,751 |
| Municipalities | 5,570 Brazilian (DF counts as one) + 171 foreign cities | 5,570 Brazilian + 181 foreign cities |
| Sections with votes | 454,450 (40 abroad not installed) | 472,028 (46 abroad and 1 in AM not installed) |
| Rows of `votacao_secao` read = (kind, number) entries of `rdv_votes` | 73,549,012 | 72,971,593 |
| Votes in = votes out | 891,177,503 | 806,832,908 |
| Candidates of `elected` equal to the sum of their sections | 25,115 of 25,115 | 26,260 of 26,260 |
| BU votes equal to `rdv_votes`, by state and turn | 55 of 56 (Pastos Bons, MA: BU 70, results 164) | 56 of 56 |
| Zone rows of `detalhe_votacao_munzona` with their sections, same count, eligible, turnout, abstention, blank | 40,329 of 40,329 | 39,966 of 39,966 |
| Zone rows with other null / valid votes (rejected candidacies) | 17,488 / 18,316 | 10,348 / 15,668 |

President: 2018 1st round Bolsonaro 49,277,010, Haddad 31,342,051; 2nd round 57,797,847 and 47,040,906. 2022 1st round Lula
57,259,504, Bolsonaro 51,072,345; 2nd round Lula 60,345,999, Bolsonaro 58,206,354 (the final accumulated totals of
`Historico_Totalizacao_Presidente_BR` are the same, valid, blank and null votes included). The 2022 runoff of the president,
section by section, is identical to the `votes` table of the portal collector (472,027 sections, 0 different; the open
data has one more, a foreign section with no vote; the names of the cities differ only in the apostrophe: `D'OESTE`, `D OESTE`).

## Raw data

The zips are not in git: they are release assets of this repository, kept exactly as the TSE publishes them, each below
2 GiB (the biggest are the 472 MiB of 2018 and the 859 MiB of 2022, both SP). The CSV inside each BU and CEFT zip has the
time of its generation in its name, which is not the one of the zip.

| Release | Assets |
|---|---|
| `data-2018` | every zip of `2018/raw/` and `MANIFEST.tsv` (name, bytes, sha256, source URL, Last-Modified) |
| `data-2022-opendata` | the same for `2022/raw/` (`data-2022` keeps the RDV and logs of the portal collector, with its own `MANIFEST.tsv`) |
| `data-2022-rdvlog-1t` | the parts of `2022/rdvlog/` (40 zips, 35 GiB, each below 2 GiB, with `MANIFEST.tsv`: name, bytes, sha256, source URL, entries) |

```
gh release create data-2022-opendata -R brauliobo/brazil-audit --title "2022 TSE open data" --notes "CC BY, see README of branch 2018"
gh release upload data-2022-opendata 2022/raw/*.zip 2022/raw/MANIFEST.tsv -R brauliobo/brazil-audit
```

To use them without the CDN:

```
gh release create data-2022-rdvlog-1t -R brauliobo/brazil-audit --title "2022 1st round RDV and logs" --notes "from the arqurnatot packages of the TSE, CC BY"
gh release upload data-2022-rdvlog-1t 2022/rdvlog/*.zip 2022/rdvlog/MANIFEST.tsv -R brauliobo/brazil-audit
```

```
gh release download data-2022-opendata -R brauliobo/brazil-audit -D 2022/raw
(cd 2022/raw && awk -F'\t' 'NR > 1 { print $3 "  " $1 }' MANIFEST.tsv | sha256sum -c)
```

## Differences between the years

| | 2018 | 2022 | 2026 |
|---|---|---|---|
| Source | TSE open data CSVs (CDN) | the same CSVs (`YEAR=2022`); the portal RDV of the runoff of the president in the `2022` branch | RDV, logs and info of the TSE portal |
| Voting times | no (only opening and closing of each section) | yes, tables `rdv_machine`, `voting_times` and `machine_sections`: the RDV and logs of round 1 from the `arqurnatot` packages (35 GiB of 70 read), of round 2 from the files of the portal | yes, table `voting_times` |
| Offices | all, both rounds | all, both rounds (and the president, runoff, from the portal) | all |
| Tables | `rdv_votes`, `section_detail`, `section_urn`, `urn_match`, `candidates`, `elected` | the same, and the 3 above; `votes` for the portal runoff | `rdv_votes`, `voting_times` |
| Fetching | 3 downloads of zips, resumable | the same | per-section files through proxies |
| Election codes | 295 to 298 | 544 to 547 | |

## License

The data are the TSE open data (https://dadosabertos.tse.jus.br/dataset/resultados-2018 and `resultados-2022`), license CC BY:
credit the Tribunal Superior Eleitoral as the source. The code is MIT, see `LICENSE`.
