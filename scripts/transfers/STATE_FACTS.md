# Observed state margins for browser SQL

The default comparison is computed by PGlite in the browser. The shipped tables
contain observations and source identities, not estimated voter transitions.
Data normalization sums disjoint source units once. National/state/city/zone
rollups are selected as one territorial antichain; overlapping totals are not
added. Governor and presidential electorates remain office-specific.

`state_rounds` has one row per `(contest_id,state,turn)`. Presidential contests
share a national contest ID, with one row for each UF. Governor contests include
the UF in their identity. Mayoral contests include the municipality: they are
never pooled into one candidate contest for a state. Historical UF codes are
retained as reported, without a guessed conversion to today's territories.
`city` is NULL outside municipal contests. A known election date supplies the
calendar `year`; `source_year` preserves the nominal year in the source archive.

Electorate, installed electorate, participation, abstention and uninstalled-section
electors appear only in `state_rounds`. They are not repeated per candidate.
`turnout_complete` verifies both participation identities. `votes_complete`
verifies that the observed vote categories close participation. Missing fields
remain NULL, missing candidates are not zero-filled and discrepancies are not
converted into a residual category.

`state_round_counts` references `(contest_id,state,turn)` and has one observed
category/candidate per row. Native nulls and technical nulls are separate
primitive categories. They may be grouped as null votes by the displayed SQL.
Annulled, annulled sub judice and separately counted votes remain separate
categories. Candidate identities are scoped to the contest and use the original
registration ID when available; historical identities additionally retain number
and reported name. No ballot number links different elections or municipalities.
Every row includes the URL and SHA256 of its exact source snapshot.

The two tables are gzip CSVs partitioned by calendar year (`<year>/all`), declared
in `data/manifest.json`. Browser COPY uses the declared columns. SQL NULL and a
reported zero have different CSV representations.

An inspectable participation query is:

```sql
select contest_id, year, date, office, state, turn,
       electorate, installed, present, absent, not_installed,
       votes_complete, turnout_complete, source_url, source_sha256
from state_rounds
where year = 2026 and state = 'ac'
order by contest_id, turn;
```

Join category counts to population with the logical key, not a sum of population
columns across candidates:

```sql
select r.contest_id, r.turn, c.category_id, c.label, c.count,
       r.electorate, r.present
from state_rounds r
join state_round_counts c
  on c.contest_id = r.contest_id and c.state = r.state
 and c.turn is not distinct from r.turn
where r.year = 2026 and r.office = 1 and r.state = 'ac';
```

Comparison SQL performs the full outer category join and computes changes and
Frechet bounds at runtime. For complete comparable margins, a cell lies between
`greatest(0, origin + destination - N)` and `least(origin,destination)`. These
are feasible limits, not observed individual transfers. When electorates change,
a minimum-administrative-balance scenario must be explicitly labeled: its
`N=greatest(TE1,TE2)` and extra administrative margin are computed from the
observations in SQL, never persisted as an observed voter category. Identical
territorial totals also do not establish the same set of individuals.

The two already evaluated Bayesian diagnostics are optional in
`data/transfers/index.json` under `models`. They are inconclusive and do not
supply a default point matrix. The expensive model and its assumptions are
explained in [METHOD.md](METHOD.md); its runtime justified keeping it outside
the default browser query path.
