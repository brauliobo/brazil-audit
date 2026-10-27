# Historical TSE archive

The official CKAN catalogue contains election collections beginning in 1933. A catalogue entry is not proof that the collection was downloaded, published, normalized or comparable with a later election.

`python3 scripts/archive/tse_archive.py catalog --output data/history/catalog.json` records every official collection/resource. The execution scope is the basic electoral data requested: candidate/party votes, white and null ballots, turnout/abstention, electorate, sections/localities and minimum candidate/list identities. Finance, assets, criminal records, proposals, surveys and administrative collections remain catalogued but explicitly excluded from this task.

`probe` records the actual HTTP size, ETag and modification date of each resource. `publish --workers 4 --catalog-output data/history/catalog.json` downloads the selected collections, checks ZIP CRCs and SHA-256, creates one `archive/<official-dataset-id>` branch and `data-<official-dataset-id>` release, and verifies the exact asset set, sizes and GitHub SHA-256 digests. Source files and public assets share disk space when unchanged. Large public assets are split below the GitHub limit and the manifest records how to concatenate them. Direct personal identifier columns are removed from candidate CSV publication; the original source hash and removed column names remain in `ARCHIVE.json`. Personal criminal-record documents are never automatically republished.

The local archive root is supplied through `--root`; it is not committed. Source downloads are content-keyed by URL and resumed atomically. Only a verified file is considered complete. No giant raw file enters Git history. Existing unrelated release assets are not overwritten.

`python3 scripts/archive/normalize_history.py` writes a separate `data/history/indicators.json` index and headered gzip CSVs. It does not rewrite the application's existing data manifest. Each election retains its actual election ID, description, year, round where applicable, office name/meaning and available territorial grain. The historical constituent election of 1933 is not relabelled as a presidential first round. Municipality and municipality–zone records retain both identifiers; historical territories retain their original state codes.

Negative official sentinel values become null, never zero. The original historical `votos líquidos` field is not silently equated with modern valid votes. Modern valid votes are exposed only when the reported total agrees with its nominal and list components. Inconsistent participation fields and conflicting duplicates remain visible in the source archive and `diagnostics.json`; only affected metrics become unavailable, rather than choosing a favourable record or dropping unrelated valid indicators. Rates must use units where both numerator and denominator are known, and must report that coverage. Never sum electorate/turnout across different offices.

Verification:

```sh
python3 -m unittest discover -s test/archive -v
```

Election identity includes the official election code, declared year, round and actual `DT_ELEICAO` when supplied. The TSE reuses some codes for supplementary elections held on different dates. The declared base-election year and archive year remain distinct from the election date; disagreements are explicit in the index and diagnostics. Historical records without dates remain undated.

`eligible` is the registered electorate. `installed` is the participation denominator, available only when the reported electorate reconciles with turnout, abstention and voters in uninstalled sections. Unexplained differences leave participation unavailable while preserving the reported electorate and original evidence.

`archive_rdv.py` selects anonymous RDV members from mixed official archives using strict HTTP206 ranges, exact Content-Range, stable ETag and ZIP CRC checks. Up to sixteen streams per bundle share a global thirty-two-connection limit across four bundle workers. Versioned immutable metadata snapshots avoid downloading the same central directory for every stream. Newly extracted members have individual SHA-256 hashes in MEMBERS.json. Existing released RDVs are referenced only when election/section identity, size and CRC32 agree; this metadata reuse is explicitly distinguished from a cryptographic source-member SHA comparison. Both older `.rdv` and newer `-rdv.dat` source conventions retain election codes, preventing first/second-round confusion.

`finalize_catalog.py` attaches only remotely verified RDV publications and the normalized-summary index. Archive publication and normalized analytical availability remain separate.

Native vote totals are preserved as `ballots_reported` (CSV `QT_VOTOS`, JSON `v.tv`). The analytical denominator `ballots` is unavailable when the reported total is smaller than a reported component; no attendance-based substitute is invented. This matters for Senate elections with two vacancies. Diagnostics identify the affected source/office groups, while the original value remains queryable.

Official state/municipality/zone counts are source facts, not precomputed estimates. The historical adapter reuses the application election configuration and exact official JSONs, including the 2026 presidential and six governor runoffs. National reference totals remain distinct from state rollups. Existing source archives are referenced by digest instead of duplicated.

A valid official ZIP containing only documentation is recorded as `empty_source`: the published source has no RDV members. Its documentation, source URL, ETag, size and inventory hash are preserved. This says nothing by itself about zero votes, zero electors, or whether a runoff took place. `data/history/availability.json` links the separate official election-configuration evidence. Unsupported RDV representations and transport failures remain errors.

## Shared election registry and browser facts

`build_election_registry.py` generates `data/elections.json` and the
`election_units` table in the main manifest from the verified historical summary
parts. Source event IDs remain distinct. Ordinary federal and statewide sources
can share a visible session; supplementary contests retain their dated identity.
The six existing election URLs remain unchanged. A missing historical round or
date stays NULL. An aggregate count of sections does not turn a UF record into a
section-level observation.

`integrate_electoral_facts.py` merges separately generated table fragments and
per-event office capabilities. Votes and participation may have different source
event codes and different grains. Their bindings preserve both; they are not
joined by year/round alone. Missing participation stays unknown when only
candidate votes exist. Browser database versions fingerprint all table schemas
and part digests, including later normalization changes.

`normalize_profiles.py` preserves complete electoral demographic cells for every
archived electorate and attendance profile. Each demographic code and its label
are retained, including source sentinel categories. Negative quantitative
sentinels become SQL NULL with the original value in `metric_sentinels`.
`level = 'state'` is an additive UF cube retaining every demographic axis;
`level = 'detail'` retains the original municipality/zone cells. Never sum these
two levels. When the TSE supplies a nationwide `BRASIL.csv` and UF copies, only
the nationwide cell file is selected. Its `SG_UF` still identifies the real UF.

Profiles are independent source snapshots, not an inferred electorate for every
contest held in that year. Generation date is not election date. Attendance
retains only the rounds supplied in that source. A nominal source year does not
link a profile to a supplementary contest held in a different calendar year.

`publish_profiles.py` keeps compact UF cubes with the application and publishes
full normalized cells on `data/historical-profiles`. Browser URLs pin the exact
commit on `raw.githubusercontent.com`, which supports CORS. These are factual
counts, not model results. Each compressed part is below 20 MB; oversized UF
files are partitioned into disjoint city-code intervals so interrupted COPY
replacements cannot delete neighboring shards. Original raw TSE archives stay
outside Git. Release ZIP exports and checksums remain available separately.

```sh
python3 scripts/archive/build_election_registry.py
nice python3 scripts/archive/normalize_profiles.py --root .cache/tse-archive --workers 4
nice python3 scripts/archive/publish_profiles.py --root .cache/tse-archive
python3 scripts/archive/integrate_electoral_facts.py --fragment data/results-facts/index.json
python3 -m unittest discover -s test/archive
```

The publication command writes the dedicated data branch and release; run it
only within an explicitly authorized publication task. It does not deploy Pages.

`election-source-bindings.json` records proven source-context equivalences. The
2008 municipal registration snapshot reports 5 October for its second-round
records; all sixty mayoral source sequences, offices and constituencies match
the dated 26 October vote source bijectively. Both reported event IDs and dates
remain inspectable. Explicit candidate-ID links connect the different source
contexts, and reported outcomes are counted once. A registration-only date
without equivalent voting evidence remains labelled as source context.
Outcome availability is independent of a direct vote file: vice-candidate
outcomes remain usable when the source reports them.

`election_places.py` preserves municipality labels from the same electoral
source context. Native-only event descriptors can add their names incrementally;
no contemporary municipality crosswalk fills missing historical labels.

`publish_section_facts.py` verifies packed native sections before publishing
bounded, fast-forward commits on `data/historical-sections`. Intermediate
checkpoints do not activate a public index. Final publication requires the full
423-source inventory, reconciles only publisher-owned obsolete pack paths, and
pins browser URLs to the verified commit. Separate yearly export releases retain
the same compressed factual bytes. Reference section totals and observed ballot
option votes retain distinct source roles and metric meanings.

Declared ZIP resources must pass ZIP structure and member CRC validation before
cache reuse or public copying. A matching file hash alone does not establish
archive integrity. Corrective source versions preserve the original published
artifact and record its superseded status and the complete source's digest.
