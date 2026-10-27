# Section observations

`section_facts.py` reads the 408 published `votacao_secao` resources and 15 `detalhe_votacao_secao` resources from the source catalogue. It produces factual rows, not statistical estimates. `election_section_votes` and `election_section_units` remain separate from official geographic rollups so loading sections cannot replace or duplicate those totals.

Run a source pilot before the complete batch:

```sh
nice python3 scripts/archive/section_facts.py --root .cache/tse-archive --output .cache/section-facts --year 1998 --state ac --workers 1
nice node scripts/check-section-facts.mjs --input=.cache/section-facts
```

The complete batch omits `--year` and `--state`; `--workers` is limited to four. Each source has an independent ready/error record. A failure never becomes an empty successful source. `--resume` verifies parser/candidate-index fingerprints and every output part hash.

Parts retain the official election/date identity, office, original TSE municipality, zone and section, source URL, source ZIP SHA256 and ZIP member. Parts are partitioned by event, UF, municipality and office, with bounded open writers and at most 16 MiB uncompressed CSV per gzip part. Gzip timestamps are zero. They are intended for immutable remote branches, not the Pages payload.

Canonical candidates are joined by an official sequence where available, otherwise by an unambiguous ballot number within the same election, office and constituency. A section's `SG_UE` may be a municipality even for governor: it does not redefine the candidate's state constituency. Unresolved identities retain all their observed votes, original ballot number and an explicit resolution status. Names are never matched approximately. Native codes 95, 96 and 97 remain blank, null and separately counted annulled votes, according to the ZIP's official `LEIAME.pdf` layout.

Some historical presidential ZIPs use the official 15-column headerless layout. Their generation date is not the election date. They are linked only to an unambiguous election with matching source year, round and office. When reported UF is `BR`, a municipality's state can be resolved only from the same election's official unit records. Original reported UF/UE and the bridge method remain in each fact. Unknown geography remains unknown; it does not erase the observed national vote count.

ZIPs may include both `BRASIL` and individual UF members. Presidential observations use the national member. Other offices use their UF member when present; additional UFs available only in the national member remain included. This avoids doubling the same sections.

The real 1998 AC regression proves a source coverage difference: the older presidential BR TXT contains 367 sections in Rio Branco, with 104,297 nominal, 2,644 blank and 11,799 null votes (118,740 total). The independent section-detail source contains 919 presidential sections across 22 municipalities and 193,081 nominal votes. Every overlapping section matches exactly. Missing municipalities are never filled with zero or substituted from aggregate data and presented as section observations. `check-section-facts.mjs` verifies all part hashes and sizes, imports the real CSVs with PGlite COPY, rejects duplicate observations and reproduces those quantities.

`pack_section_facts.py --input .cache/section-facts --output .cache/section-packs` repacks those observations without rereading the original ZIPs. Transport packs combine municipalities within one source/UF/office, up to 50,000 rows or 32 MiB raw CSV, and validate the compressed file remains below 20 MiB. Their city ranges and exact city/event lists support lazy imports. `source_part` identifies exactly one physical pack and is its sole deletion predicate: importing a new hash of one pack cannot erase another pack containing the same municipality. The real PGlite regression changes one pack's content and verifies that the overlapping municipality's other pack is preserved. The 1998 AC pilot falls from 199 source shards to 11 transport packs with identical observations.
