# Observed comparisons in browser SQL

The default path ingests official observations and computes comparisons with
PGlite in the browser. It does not precompute inferred voter transitions.
[STATE_FACTS.md](STATE_FACTS.md) describes the schema, population accounting,
source identities and inspectable example queries.

Rebuild the two factual tables from the downloaded official source archives:

```sh
nice python scripts/transfers/state_facts.py --archive-root "$TRANSFERS_ARCHIVE_ROOT"
python scripts/transfers/verify.py
```

The archive catalog documents original TSE URLs. The state tables preserve
historical codes, calendar election dates, distinct municipal contests and
unknown fields. Office-specific official JSONs supply 2026 state totals; no
presidential electorate is substituted for a governor electorate. Missing counts
are not a residual category or an inferred zero.

The expensive ecological model remains an explicitly optional research tool.
Its measured runtime was about 23 minutes per complete contest with two CPUs;
both published diagnostics are inconclusive. They are not the default matrix.
Read [METHOD.md](METHOD.md) for its exact likelihood, fixed protocol, population
scenarios and strict convergence/adequacy/prior-sensitivity gates.

To reproduce that optional model, create an isolated Python environment with
`requirements.txt`. Its preparatory scripts and fit CLI remain separate:

```sh
nice python scripts/transfers/build.py --archive-root "$TRANSFERS_ARCHIVE_ROOT"
nice python scripts/transfers/build_regional.py --archive-root "$TRANSFERS_ARCHIVE_ROOT"
python scripts/transfers/package_inputs.py
nice env OPENBLAS_NUM_THREADS=1 NUMBA_NUM_THREADS=1 python scripts/transfers/fit.py CONTEST_ID --cores 2
```

Those commands explicitly create the optional precomputed research artifacts;
they are not run by the browser's factual comparison flow. The earlier regional
batch was stopped when the requested default changed to state observations.
Its checkpoints remain local and no sampling resumes automatically.

Run focused checks with:

```sh
nice env OPENBLAS_NUM_THREADS=1 NUMBA_NUM_THREADS=1 python -m unittest discover -s test/transfers
```

Build and compilation tasks use `nice` and at most four workers. Independent
sampling can also be bounded explicitly. Exact small-table tests compare
stationary laws to exhaustive enumeration, test prior-generated calibration,
preserve margins/bounds and verify reproducible checkpoint continuation. They
do not establish that real electoral behavior follows the model assumptions.
