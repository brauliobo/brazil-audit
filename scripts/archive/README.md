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

`archive_rdv.py` selects anonymous RDV members from mixed official archives using strict HTTP206 ranges, exact Content-Range, stable ETag and ZIP CRC checks. Eight streams per bundle and four bundles bound network concurrency. Newly extracted members have individual SHA-256 hashes in MEMBERS.json. Existing released RDVs are referenced only when election/section identity, size and CRC32 agree; this metadata reuse is explicitly distinguished from a cryptographic source-member SHA comparison. Both older `.rdv` and newer `-rdv.dat` source conventions retain election codes, preventing first/second-round confusion.

`finalize_catalog.py` attaches only remotely verified RDV publications and the normalized-summary index. Archive publication and normalized analytical availability remain separate.
