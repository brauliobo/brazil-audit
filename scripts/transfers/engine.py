"""Conditional homogeneous RxC ecological models; never individual-vote linkage.

Goodman-style constrained population-weighted ecological regression is compared
with a homogeneous multinomial mixture likelihood. Every fit uses direct linear
constraints for the observed overall margins; there is no IPF balancing step.
"""
import os
os.environ.setdefault('OPENBLAS_NUM_THREADS', '1')
os.environ.setdefault('OMP_NUM_THREADS', '1')
import numpy as np
from scipy.optimize import minimize, Bounds, LinearConstraint
from scipy.special import xlogy
from scipy.stats import chi2

METHOD_VERSION = 'homogeneous-rxc-1'


def validate_margins(x, y):
    x, y = np.asarray(x, dtype=float), np.asarray(y, dtype=float)
    if x.ndim != 2 or y.ndim != 2 or len(x) != len(y):
        raise ValueError('margins must have the same territorial units')
    if not np.isfinite(x).all() or not np.isfinite(y).all() or (x < 0).any() or (y < 0).any():
        raise ValueError('margins must be finite nonnegative counts')
    if not np.equal(x, np.floor(x)).all() or not np.equal(y, np.floor(y)).all():
        raise ValueError('observed margins must be integer counts')
    if not np.array_equal(x.sum(axis=1), y.sum(axis=1)) or (x.sum(axis=1) == 0).any():
        raise ValueError('incompatible territorial populations; do not balance them')
    return x, y


def feasible_bounds(x, y):
    x, y = validate_margins(x, y)
    n = x.sum(axis=1)[:, None, None]
    return (np.maximum(0, x[:, :, None] + y[:, None, :] - n).sum(axis=0),
            np.minimum(x[:, :, None], y[:, None, :]).sum(axis=0))


def fit_probabilities(x, y, method='multinomial', sample_weights=None):
    x, y = validate_margins(x, y)
    r, c = x.sum(axis=0), y.sum(axis=0)
    active_r, active_c = r > 0, c > 0
    x1, y1 = x[:, active_r], y[:, active_c]
    pops = x.sum(axis=1)
    a, b = x1 / pops[:, None], y1 / pops[:, None]
    nr, nc = a.shape[1], b.shape[1]
    result = np.zeros((len(r), len(c)))
    if nc == 1:
        result[np.ix_(active_r, active_c)] = 1
        return result, {'success': True, 'rank': int(np.linalg.matrix_rank(a)), 'active_rows': nr, 'iterations': 0}
    mass_r, mass_c = r[active_r] / r.sum(), c[active_c] / c.sum()
    eq = np.zeros((nr + nc - 1, nr * nc))
    for i in range(nr):
        eq[i, i * nc:(i + 1) * nc] = 1
    for j in range(nc - 1):
        eq[nr + j, j::nc] = mass_r
    target = np.r_[np.ones(nr), mass_c[:-1]]
    weights = np.ones(len(x)) if sample_weights is None else np.asarray(sample_weights, dtype=float)
    weights = weights * pops / np.sum(weights * pops)
    tiny = 1e-12  # numerical interior for log-likelihood; recorded in the method metadata

    def objective(flat):
        p = flat.reshape(nr, nc)
        q = a @ p
        if method == 'multinomial':
            loss = -np.sum(weights[:, None] * xlogy(b, q))
            grad = -(a.T @ (weights[:, None] * b / q))
        elif method == 'wls':
            delta = q - b
            loss = np.sum(weights[:, None] * delta * delta)
            grad = 2 * a.T @ (weights[:, None] * delta)
        else:
            raise ValueError('unknown ecological estimator')
        return float(loss), grad.ravel()

    opt = minimize(objective, np.tile(mass_c, nr), method='SLSQP', jac=True,
                   bounds=Bounds(tiny, 1), constraints=LinearConstraint(eq, target, target),
                   options={'ftol': 1e-10, 'maxiter': 400})
    if not opt.success:
        raise RuntimeError(f'ecological fit failed: {opt.message}')
    p = opt.x.reshape(nr, nc)
    if np.max(np.abs(eq @ opt.x - target)) > 1e-7:
        raise RuntimeError('ecological fit violates observed margins')
    result[np.ix_(active_r, active_c)] = p
    return result, {'success': True, 'rank': int(np.linalg.matrix_rank(a)), 'active_rows': nr,
                    'condition': float(np.linalg.cond(a)), 'iterations': int(opt.nit)}


def estimate(x, y, clusters=None, bootstrap=100, seed=20261025):
    x, y = validate_margins(x, y)
    r, c = x.sum(axis=0), y.sum(axis=0)
    lower, upper = feasible_bounds(x, y)
    n, nr, nc = len(x), np.count_nonzero(r), np.count_nonzero(c)
    output = {'status': 'inconclusive', 'reason': None, 'counts': None, 'rowShares': None,
              'low': None, 'high': None, 'boundLow': lower.tolist(), 'boundHigh': upper.tolist(),
              'diagnostics': {'units': n, 'activeRows': int(nr), 'activeColumns': int(nc)}}
    if n <= nr:
        output['reason'] = 'insufficient_units'
        return output
    rank = np.linalg.matrix_rank(x[:, r > 0] / x.sum(axis=1)[:, None])
    if rank < nr:
        output['reason'] = 'rank_deficient'
        return output
    p, diagnostics = fit_probabilities(x, y)
    wls, _ = fit_probabilities(x, y, method='wls')
    expected = x @ p
    ratio = np.divide(y, expected, out=np.ones_like(y), where=expected > 0)
    deviance = max(0.0, float(2 * np.sum(xlogy(y, ratio))))
    # A saturated territorial multinomial has U*(C-1) parameters. Overall column
    # margins constrain C-1 of the homogeneous model's R*(C-1) free parameters.
    df = max(1, int((n - nr + 1) * (nc - 1)))
    lack_of_fit = float(chi2.sf(deviance, df))
    diagnostics.update({'deviance': deviance, 'degreesOfFreedom': df, 'lackOfFitP': lack_of_fit,
                        'dispersion': deviance / df,
                        'weightedRmse': float(np.sqrt(np.sum((expected-y)**2 / x.sum(axis=1)[:,None]) / x.sum())),
                        'wlsSensitivityMax': float(np.max(np.abs(p-wls)))})
    output['diagnostics'].update(diagnostics)
    # Reject a visibly incompatible homogeneous model, rather than display its
    # coefficient table as if it recovered individual transfers.
    if lack_of_fit < 0.01:
        output['reason'] = 'heterogeneous_behavior'
        return output
    if bootstrap < 20:
        raise ValueError('at least 20 territorial bootstrap replicates are required')
    labels = np.asarray(clusters if clusters is not None else [str(i) for i in range(n)])
    unique = np.unique(labels)
    if len(unique) < 5:
        output['reason'] = 'insufficient_units'
        return output
    rng = np.random.default_rng(seed)
    draws = []
    for _ in range(bootstrap):
        sampled = rng.choice(unique, size=len(unique), replace=True)
        multiplicity = {k: int(np.count_nonzero(sampled == k)) for k in unique}
        weights = np.array([multiplicity[k] for k in labels])
        q, _ = fit_probabilities(x, y, sample_weights=weights)
        draws.append(r[:,None] * q)
    counts = r[:,None] * p
    ci = np.quantile(draws, [0.025,0.975], axis=0)
    output.update({'status':'estimated','counts':counts.tolist(),'rowShares':p.tolist(),
                   'low':ci[0].tolist(),'high':ci[1].tolist()})
    output['diagnostics'].update({'bootstrap': bootstrap,'clusters':len(unique),'seed':seed})
    return output
