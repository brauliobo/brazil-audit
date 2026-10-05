# Brazil election audit: 2018 collector

Downloads the TSE open data of the 2018 general election (president, governor, senator, federal, state and district
deputy; both rounds) and imports the votes of every section into PostgreSQL, in the same shape as the 2026 collector.
The 2022 data lives in the `2022` branch, the 2026 collector in `2026` and the analysis app in `main`.

## What exists and what does not

The raw files of the voting machines (RDV, logs and the BU files of the urns) of 2018 are **not published**: the results
portal and the `arqurnatot` package answer 404. So, unlike 2026, there are **no RDV, no logs and no voting times** (the
time of each vote). What the TSE publishes as open data is enough for the votes of every section and, from the
boletim de urna CSVs, the time each section opened and closed its voting.

| Source | What it gives |
|---|---|
| `votacao_secao` (27 states + `BR`) | votes per section, turn, office and candidate/party/blank/null; `BR` is the president in all states, foreign vote (ZZ) included |
| `detalhe_votacao_secao` | turnout of each section and office (eligible, turnout, abstention, nominal, blank, null, legend), polling place, when the TSE received the BU |
| `BWEB_*` (boletim de urna CSV) | per section and turn: urn number, flash card and load, opening and closing times, aggregated sections, biometric voters |
| `CEFT_*` (correspondência efetivada) | per section and turn: the urn expected and the one used (divergence), origin of the vote (urn or RED) |
| `consulta_cand` | the registry of candidates |
| `votacao_candidato_munzona` | votes per candidate, municipality and zone, with the outcome (`ELEITO`, `2º TURNO`, ...) |

Also downloaded and kept raw, nothing is imported from them: `detalhe_votacao_munzona`, `votacao_partido_munzona`,
`consulta_cand_complementar`, `consulta_coligacao`, `consulta_vagas`, `motivo_cassacao`, `eleitorado_local_votacao`
and `perfil_eleitor_secao` (electorate profile per section). Each zip has its `leiame.pdf` with the layout.

There are 454,490 sections (principal ones: the 27,370 aggregated sections, `aggregated` in `section_urn`, vote in the
urn of another one and have no rows of their own). 40 of them, abroad, were not installed and have no votes. The times in
the BU CSVs are local time of the section (Acre opens at 08:00 there).

## Run

```
createdb brazil-audit-2018
bin/collect-2018
```

It downloads the zips into `2018/raw/` (once each, with resume and a size check) and imports them. The tables are created
on the first run. A resume downloads what `2018/raw/MANIFEST.tsv` does not list and imports the files not in `imports`.

| Env | |
|---|---|
| `WORKERS` | parallel downloads and imports, 1 to 3 (default and maximum 3) |
| `PHASE` | `fetch` or `import` to run only one step (default: both) |
| `STATES` | import only these units, e.g. `STATES="AC BR ZZ"` (default: the 27 states, `BR` and `ZZ`) |
| `DB_NAME` | database (default `brazil-audit-2018`) |

It runs at low CPU and disk priority (`nice`, `ionice`). Needs PostgreSQL, `curl` and `unzip`.

## How it works

`lib/sources.rb` lists the files, `lib/download.rb` fetches each one and `lib/manifest.rb` records it. The CDN answers a
`Content-Length` of 1 to HEAD and none to some GETs while a file is not cached, so the size is checked after the download
with a 1 byte range request (`Content-Range`), and a file is only listed in the manifest when its size matches.

The importer streams each CSV out of its zip (`unzip -p`) into an UNLOGGED staging table with `COPY` (`LATIN1`, `;`,
`#NULO#` as NULL), aggregates it in SQL into the final table and drops the staging table, all in one transaction that also
writes the row of the file in `imports` (rows read, rows loaded, votes, unclassified and skipped rows). Rows never go
through Ruby.
The `*_BRASIL.csv` of the zips is every state again and is skipped; the zip of `detalhe_votacao_secao` has an empty `ZZ`
file, the foreign sections are in its `BR` file.

Only the general election (`cd_eleicao` 295 and 296 for the president, 297 and 298 for the rest) is imported. The files
also carry the supplementary election of the Mato Grosso senator (15 November 2020), with the same turn and office as the
general one, and the urn files the local plebiscites of 7 October: their rows are skipped and counted in `imports.skipped`.

The TSE does not escape the quotes inside a field (`ALICE SANT"ANA`, `PROF, JADSON MACEDO "JAJÁ"`): `COPY` would take them
as the end of the field and merge thousands of rows without any error (the first round BU of Bahia lost 45% of its rows).
So the quotes around the fields are taken out on the way in (`sed`), `COPY` reads the lines split by `;`, and an import
fails when the rows read differ from the lines of the CSV.

`rdv_votes` has the votes as cast: those of the candidates whose candidacy was rejected (`INAPTO`) are there, while
`votacao_candidato_munzona` (so `elected`) and the zone totals of `detalhe_votacao_munzona` leave them out or count them as
null. About 0.8% of the nominal votes are in this case.

## Tables

States are lowercase (`zz` is the foreign vote, `br` the president in `candidates` and `elected`), zones and sections are
zero padded to 4 digits, `city_code` is the 5 digit TSE code. The key of a section is `(state, city_code, zone, section)`.

| Table | Key | |
|---|---|---|
| `rdv_votes` | section, turn, office | `votes` is `{ kind => { number => votes } }` (jsonb) |
| `section_detail` | section, turn, office | turnout and kinds of votes, polling place, when the BU was received |
| `section_urn` | section, turn | urn, votes recorded in it, flash card, loads, aggregated sections, opening and closing, biometric voters |
| `urn_match` | section, turn | urn expected and used, origin and divergence |
| `candidates` | `sq_candidato`, turn | number, names, party, coalition, status, outcome, gender, race, education, occupation |
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
| 5 | `''` | annulled and counted apart (97), only in two sections of Salvador (BA, zone 18, sections 202 and 328), 1st round |

A row is counted as unclassified when its number says nominal but its `sq_candidato` is not a candidate, or the other way
round; `imports.unclassified` has the count of each file.

## Coverage and checks

454,490 sections in 6,273 zones and 5,741 municipalities: the 5,570 Brazilian ones (DF counts as one) and 171 foreign
cities (`zz`, 784 sections). 454,450 sections have votes in the 1st round: the 40 not installed ones are abroad. Every
municipality and zone of `detalhe_votacao_munzona` has its sections, with the same section count, eligible voters, turnout,
abstention and blank votes. Checked at the end of the import:

- rows read of `votacao_secao` (73,549,012) equal the (kind, number) entries of `rdv_votes`, per file, and so do the votes
  (891,177,503); no row is unclassified;
- the nominal votes of the 25,115 candidates of `elected` equal the sum of their sections, president, governors, senators and
  deputies;
- the votes of the BU CSVs equal the ones of `rdv_votes` in 55 of the 56 states and turns (Pastos Bons, MA: the BU has 70
  votes in section 25 of zone 17, the results and the detail 164);
- president, 1st round: Bolsonaro 49,277,010, Haddad 31,342,051; 2nd round: Bolsonaro 57,797,847, Haddad 47,040,906.

The zone totals of null and valid votes of `detalhe_votacao_munzona` differ from the section ones in 18,316 zone rows, always
by less valid votes: the TSE counts there the votes of the candidacies it rejected as null or annulled.

## Raw data

The zips are not in git: they are release assets of this repository, kept exactly as the TSE publishes them, each below
2 GiB (the biggest is 472 MiB, 4.7 GiB in all). The CSV inside each BU and CEFT zip has the time of its generation in its
name, which is not the one of the zip.

| Release | Assets |
|---|---|
| `data-2018` | every zip of `2018/raw/` and `MANIFEST.tsv` (name, bytes, sha256, source URL, Last-Modified) |

```
gh release create data-2018 -R brauliobo/brazil-audit --title "2018 TSE open data" --notes "CC BY, see README of branch 2018"
gh release upload data-2018 2018/raw/*.zip 2018/raw/MANIFEST.tsv -R brauliobo/brazil-audit
```

To use them without the CDN:

```
gh release download data-2018 -R brauliobo/brazil-audit -D 2018/raw
(cd 2018/raw && awk -F'\t' 'NR > 1 { print $3 "  " $1 }' MANIFEST.tsv | sha256sum -c)
```

## Differences from the other years

| | 2018 | 2022 | 2026 |
|---|---|---|---|
| Source | TSE open data CSVs (CDN) | RDV of the TSE portal | RDV, logs and info of the TSE portal |
| Voting times | no (only opening and closing of each section) | logs collected (in the `data-2022` release), never imported | yes, table `voting_times` |
| Offices | all, both rounds | president, 2nd round | all |
| Tables | `rdv_votes`, `section_detail`, `section_urn`, `urn_match`, `candidates`, `elected` | `votes` | `rdv_votes`, `voting_times` |
| Fetching | 3 downloads of zips, resumable | per-section files through proxies | per-section files through proxies |

## License

The data are the TSE open data (https://dadosabertos.tse.jus.br/dataset/resultados-2018), license CC BY: credit the
Tribunal Superior Eleitoral as the source. The code is MIT, see `LICENSE`.
