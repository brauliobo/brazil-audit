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

## Publication checks

Two independently seeded chains must have rank-normalized Rhat <= 1.01 and
bulk/tail effective sample sizes >= 400 for every mathematically variable flow
and hyperparameter. A free cell constant across samples is a convergence failure,
not a deterministic cell. Bounds that collapse identify a deterministic table
without requiring MCMC. Posterior predictive checks use new local probabilities
from the inferred hierarchy, not fitted local probabilities. Alternative prior
sensitivity is reported separately and must be evaluated before publication.
A failed chain never produces displayed point estimates.

Territorial bounds are sums of max(0,r_ui+c_uj-N_u) and min(r_ui,c_uj), rather
than the weaker bounds computed from national margins alone.

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
