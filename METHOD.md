# Electoral transition scenarios from aggregate margins

Individual votes are secret. No transition in these outputs is observed at
individual level. Areas with compatible totals do not establish a stable cohort.
Candidate identities are specific to the election and contest; blank, null and
abstention remain distinct categories.

## Exact hierarchical count model

For each territorial unit u, the unobserved integer table T has observed row
margins r (first round) and column margins c (second round). Conditional on local
row probabilities beta, the likelihood is proportional to

    product(u,i,j) beta[u,i,j] ** T[u,i,j] / factorial(T[u,i,j]).

Each row beta[u,i] has a Dirichlet(alpha[i]) prior. Hyperparameters alpha[i,j]
have independent Gamma(shape=4, rate=0.5) priors. Integrating beta exactly gives

    product(u,i) Gamma(sum(alpha[i])) / Gamma(sum(alpha[i])+r[u,i])
      * product(j) Gamma(alpha[i,j]+T[u,i,j])
                     / (Gamma(alpha[i,j])*factorial(T[u,i,j])).

The row-multinomial coefficients depend only on observed margins and cancel.
The normalizing sum over feasible tables is not approximated: tables themselves
are sampled as latent variables. This differs from the aggregate multinomial
mixture approximation used by some RxC software.

The sampler uses symmetric uniform proposals on the complete feasible support
of each 2x2 block and accepts them using the exact collapsed density ratio.
Random row/column permutations connect all table cells. These moves preserve
both observed margins exactly, allowing changes proportional to population
size. Positive alpha has a rowwise lognormal Metropolis proposal, including its
Jacobian. Initial tables are independent central hypergeometric draws with
correct integer margins; initialization is not a fitted or balanced estimate.

Every saved draw must have the original margins and satisfy the sum of the
territory-specific Frechet bounds. Displayed estimates are posterior means;
intervals are equal-tailed posterior 95% intervals conditional on this model,
prior, territorial partition and population scenario. They do not account for
unobserved changes in electoral registration or establish individual behavior.

## Population and territorial scenarios

The modeled categories include each valid first-round candidate, blank votes,
null votes (native plus technical nulls), abstention and any separately reported
annulled/sub judice vote categories. Annulled categories are not assigned to a
candidate or converted into null votes. Office-specific electorates are used:
presidential eligibility cannot replace governor eligibility for voters in transit.
Uninstalled-section electors remain a separate administrative category.

When a territorial electorate changes between rounds, the minimum-registration
scenario uses N_u=max(TE_u1,TE_u2) and adds the observed positive difference to a
separate administrative-balance category in the smaller margin. This is a
minimum-turnover assumption. It is not a measured origin/destination for mobile
voters. Summing N_u may count a geographically reassigned voter twice, so that
augmented scenario total is NEVER labeled the Brazilian electorate. Observed TE
for each round is reported separately. Even identical totals do not prove an
unchanged set of people. A strict compatible-total scenario and exploratory
0.1%/1% gross-turnover bound scenarios are also published; the latter are
assumptions, not observed voter counts or confidence intervals.

Presidential fits use UF units. Governor regional fits aggregate every mapped
municipality into official IBGE immediate regions in the snapshot consulted in
2026. The exact TSE municipality code -> IBGE municipality code crosswalk is
validated against the official registries. Applying this current partition to
historical municipality identifiers does not reconstruct historical boundaries.
Municipal inputs remain separately available. A historical source published only
at UF level cannot be reconstructed into municipalities or regions. Mayoral
contests use municipality-zone intersections within that single contest, never
pooled candidates from different municipalities.

Before fitting, the design must contain more territorial units than active
origin categories and have full column rank. This is a conservative eligibility
policy for ecological estimation, not proof that individual transitions are
identified. Insufficient variation, missing source grain, invalid margins and an
uncomputed fit have different statuses. Overlapping national/UF/city/zone rollups
are validated and selected as one territorial antichain; they are never summed
as separate electors.

## Publication checks and fixed adaptive protocol

Each prior uses two independently seeded chains. Rank-normalized Rhat must be
<=1.01 and bulk AND tail effective sample sizes must be >=400 for every
mathematically variable flow and hyperparameter. Free cells constant across
samples fail convergence. Bounds that collapse identify a deterministic table
without requiring MCMC or otherwise unidentifiable hyperparameters.

The predeclared stages use60,000,150,000,600,000 and1,000,000 total sweeps per
chain. There are20,000 initial warmup sweeps and thinning20. Saved-draw counts
are2,000/6,500/29,000/49,000. The corresponding additional discarded prefixes
are0/1,500/9,000/9,000 saved draws, giving total warmup20k/50k/200k/200k.
Every500 saved draws form a seeded reproducible segment. A later stage extends
the same checkpointed latent tables and hyperparameters. Each prior stops only
when all gates pass or after the final stage. The final stage may produce an
inconclusive result; no seed, cutoff or posterior is selected to manufacture a fit.

The posterior predictive discrepancy is a stabilized Pearson-type statistic:

    D(y,alpha) = sum(u,j) (y[u,j] - expected[u,j])**2 / max(expected[u,j],1)
    expected[u,j] = sum(i) r[u,i] * alpha[i,j] / sum(k) alpha[i,k].

For each retained hyperparameter draw, NEW local probabilities are sampled from
Dirichlet(alpha), then row multinomial counts are simulated and aggregated by
destination. This tests the inferred hierarchy's territorial dispersion, rather
than merely replicating fitted local probabilities. The predictive value is the
fraction with D(y_rep,alpha)>=D(y_observed,alpha). The predeclared bilateral
acceptance gate is0.025<=PPC<=0.975. A good chain does not override a failed
predictive check. This is a posterior predictive diagnostic, not a frequentist
p-value with a claimed nominal false-positive rate.

Both Gamma(shape=4,rate=0.5) and the sensitivity Gamma(shape=2,rate=0.25) must
pass convergence and predictive gates. They have the same mean8 and the latter
has twice the variance. Conditional posterior means and intervals are kept
separate. A maximum difference above10percentage points in an origin row is
classified prior-sensitive/inconclusive for the default point matrix. This is a
predeclared interpretation policy, not a test of individual voter truth. If either
chain fails, prior sensitivity is not evaluable; unconverged mean differences
are not reported as a sensitivity conclusion. Intervals are not merged into a
misleading95% interval. A failed fit never produces a displayed point estimate.

Territorial bounds are sums of max(0,r_ui+c_uj-N_u) and min(r_ui,c_uj), rather
than the weaker bounds computed from national margins alone. They remain
consultable independently of whether the statistical model has been computed
or has passed its checks.

## References and limitations

- Rosen, Jiang, King and Tanner (2001), Bayesian and frequentist inference for
  ecological inference: the R x C case. Statistica Neerlandica 55(2),134–156.
  https://doi.org/10.1111/1467-9574.00162
- Greiner and Quinn (2009), R x C ecological inference: bounds, correlations,
  flexibility and transparency of assumptions. Bayesian Analysis4(2),329–366.
  https://doi.org/10.1214/09-BA415
- PyEI provides inspectable multinomial-Dirichlet and latent-table implementations:
  https://github.com/mggg/ecological-inference
- Approximate aggregate likelihoods can yield substantial bias; the exact latent
  count likelihood above avoids that approximation, not ecological identification
  uncertainty: https://arxiv.org/abs/2410.18243

The homogeneous ecological regression is a separate baseline and sensitivity
comparison. Its rejection does not establish that the heterogeneous model is
correct. Ecological confounding, territorial aggregation and prior dependence
remain material limitations even with satisfactory computational diagnostics.
