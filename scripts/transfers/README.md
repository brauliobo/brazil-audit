# Reproduce ecological transition scenarios

Read [METHOD.md](METHOD.md) before interpreting any estimate. The published
aggregate input matrices are sufficient to rerun a fit; the source links and
hashes permit checking the original electoral margins independently.

Create an isolated Python environment and install `requirements.txt`. Run build
and compilation commands with `nice` and at most four workers. Sampling should
also be bounded; each fit supports one or two independent worker processes.

To rebuild observed inputs from the downloaded official source archives:

```sh
nice python scripts/transfers/build.py --archive-root "$TRANSFERS_ARCHIVE_ROOT"
nice python scripts/transfers/build_regional.py --archive-root "$TRANSFERS_ARCHIVE_ROOT"
python scripts/transfers/package_inputs.py
```

The historical archive catalog documents the original TSE download URLs. The
2026 presidential inputs use official first- and second-round JSONs, not missing
RDV counts. Regional grouping uses the official TSE `cd`/`cdi` crosswalk and
IBGE immediate-region membership, with the snapshot explicitly labeled2026.
Municipal source matrices remain separate. A source published only at state
level cannot be reconstructed into municipalities or regions.

Fit a prepared contest:

```sh
nice env OPENBLAS_NUM_THREADS=1 NUMBA_NUM_THREADS=1 python scripts/transfers/fit.py CONTEST_ID --cores 2
```

The fixed adaptive protocol evaluates60k,150k,600k and1million sweeps per chain.
Every500 saved draws form a reproducible seeded segment. Checkpoints preserve
latent aggregate tables, hyperparameters and previous samples, so later stages
extend the same chains. Numerical gates are never relaxed to create estimates.
Both the primary Gamma(4,0.5) prior and Gamma(2,0.25) sensitivity prior must pass.
A maximum difference above10percentage points by origin is classified as prior
sensitive and leaves the default point matrix disabled. This is a declared
interpretation policy, not a test that an individual transition is true.

`not_applicable`, missing source grain, insufficient identifying areas,
inconsistent source margins, an uncomputed fit and a failed fit have separate
states. A pending calculation is not an inconclusive statistical finding.

Verification:

```sh
nice env OPENBLAS_NUM_THREADS=1 NUMBA_NUM_THREADS=1 python -m unittest discover -s test/transfers
python scripts/transfers/verify.py
```

The exact small-table tests compare stationary laws to exhaustive enumeration,
check interval calibration under the stated prior-generating model, preserve
margins/bounds, and verify checkpoint continuation. Those tests do not establish
that real electoral behavior follows the hierarchical assumptions.
