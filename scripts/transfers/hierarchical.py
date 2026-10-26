"""Exact latent-table multinomial/Dirichlet ecological model.

T_u has observed row AND column margins. Conditional 2x2 table updates use
Fisher's noncentral hypergeometric law, as in latent-table ecological inference
(Greiner & Quinn, Bayesian Analysis 2009). No aggregate multinomial surrogate.
"""
import os
os.environ.setdefault('OPENBLAS_NUM_THREADS','1')
os.environ.setdefault('OMP_NUM_THREADS','1')
import numpy as np
import hashlib,json
from pathlib import Path
from scipy.special import gammaln
from scipy.stats import random_table
from engine import validate_margins, feasible_bounds
from status import assess,GATES


def collapsed_block_logmass(q, alpha):
    return (gammaln(q+alpha)-gammaln(q+1)).sum(axis=(-2,-1))


def collapsed_sweep(t,alpha,rng):
    """Uniform-support MH in each 2x2 block of the exact collapsed model.

    Symmetric proposals can move O(N); no individual probability beta remains
    to pin count moves to O(sqrt(N)). Every acceptance ratio is exact DM mass.
    """
    _,r,c=t.shape
    row_order=rng.permutation(r);col_order=rng.permutation(c)
    for ii in range(r-1):
        i,k=row_order[ii],row_order[ii+1]
        for jj in range(c-1):
            j,l=col_order[jj],col_order[jj+1]
            current=t[:,[i,k]][:,:,[j,l]].copy()
            n1=current[:,0,:].sum(axis=1);n2=current[:,1,:].sum(axis=1)
            m1=current[:,:,0].sum(axis=1)
            low=np.maximum(0,m1-n2);high=np.minimum(n1,m1)
            z=rng.integers(low,high+1)
            proposal=np.stack([z,n1-z,m1-z,n2-m1+z],axis=1).reshape(-1,2,2)
            a=alpha[np.ix_([i,k],[j,l])]
            ratio=collapsed_block_logmass(proposal,a)-collapsed_block_logmass(current,a)
            keep=np.log(rng.random(len(t)))<ratio
            for v,rr in enumerate([i,k]):
                for w,cc in enumerate([j,l]):t[keep,rr,cc]=proposal[keep,v,w]
    return t


def collapsed_alpha_log_density(alpha,t,shape,rate):
    counts=t.sum(axis=2)
    value=(gammaln(alpha.sum(axis=1))[None,:]-gammaln(alpha.sum(axis=1)[None,:]+counts)
           +(gammaln(t+alpha)-gammaln(alpha)).sum(axis=2)).sum(axis=0)
    return value+((shape-1)*np.log(alpha)-rate*alpha).sum(axis=1)

def sample_chain(x,y,seed,draws,tune,thin=2,prior_shape=4,prior_rate=.5):
    if draws%500:raise ValueError('sampling draws must use complete reproducible 500-draw segments')
    rng=np.random.default_rng(seed)
    t=np.array([random_table.rvs(a,b,random_state=rng) for a,b in zip(x,y)],dtype=np.int64)
    alpha=rng.gamma(prior_shape,1/prior_rate,size=(x.shape[1],y.shape[1]))
    from sampler import run
    # Fixed-size seeded segments make extension reproducible without restarting
    # previously verified chains. The saved state is a latent aggregate table.
    key=hashlib.sha256(x.tobytes()+y.tobytes()+json.dumps([seed,tune,thin,prior_shape,prior_rate,500]).encode()+Path(__file__).with_name('sampler.py').read_bytes()).hexdigest()
    directory=Path('.cache/transfers-chains');directory.mkdir(parents=True,exist_ok=True)
    path=directory/f'{key}.npz'
    saved=np.empty((0,x.shape[1],y.shape[1]),dtype=np.int64)
    alpha_saved=np.empty((0,x.shape[1],y.shape[1]));acceptances=[]
    if path.exists():
        previous=np.load(path);t=previous['table'];alpha=previous['alpha']
        saved=previous['saved'];alpha_saved=previous['alpha_saved'];acceptances=previous['acceptances'].tolist()
    while len(saved)<draws:
        segment=len(saved)//500
        count=min(500,draws-len(saved))
        more,more_alpha,acceptance=run(t,alpha,(seed+segment*15485863)%(2**32),count,tune if len(saved)==0 else 0,thin,prior_shape,prior_rate)
        saved=np.concatenate([saved,more]);alpha_saved=np.concatenate([alpha_saved,more_alpha]);acceptances.append(acceptance)
        temporary=path.with_suffix('.tmp.npz')
        np.savez_compressed(temporary,table=t,alpha=alpha,saved=saved,alpha_saved=alpha_saved,acceptances=acceptances)
        temporary.replace(path)
    saved=saved[:draws];alpha_saved=alpha_saved[:draws];acceptance=float(np.mean(acceptances))
    ppc=[]
    for alpha in alpha_saved:
        gp=rng.gamma(np.broadcast_to(alpha,t.shape));bp=gp/gp.sum(axis=2,keepdims=True)
        replicated=rng.multinomial(x,bp).sum(axis=1)
        expected=x@(alpha/alpha.sum(axis=1,keepdims=True))
        denom=np.maximum(expected,1)
        ppc.append([float(((y-expected)**2/denom).sum()),float(((replicated-expected)**2/denom).sum())])
    return saved,alpha_saved,np.array(ppc),acceptance


def fit_hierarchical(x,y,seed=20261025,draws=1000,tune=2000,thin=2,prior_shape=4,prior_rate=.5,cores=1,discard=0):
    x,y=validate_margins(x,y)
    rows=x.sum(axis=0)>0;cols=y.sum(axis=0)>0
    a=x[:,rows].astype(np.int64);b=y[:,cols].astype(np.int64)
    low_bound,high_bound=feasible_bounds(a,b)
    if np.array_equal(low_bound,high_bound):
        exact=np.zeros((x.shape[1],y.shape[1]));exact[np.ix_(rows,cols)]=low_bound
        return {'counts':exact.tolist(),'low':exact.tolist(),'high':exact.tolist(),
                'status':'estimated','reason':None,'diagnostics':{'identification':'exact_bounds_collapse','maxMarginError':0,'boundsViolations':0}}
    if cores==1:
        chains=[sample_chain(a,b,seed+i*104729,draws,tune,thin,prior_shape,prior_rate) for i in range(2)]
    else:
        from concurrent.futures import ProcessPoolExecutor
        with ProcessPoolExecutor(max_workers=min(cores,2)) as executor:
            futures=[executor.submit(sample_chain,a,b,seed+i*104729,draws,tune,thin,prior_shape,prior_rate) for i in range(2)]
            chains=[f.result() for f in futures]
    chains=[(q[0][discard:],q[1][discard:],q[2][discard:],q[3]) for q in chains]
    requested_draws=draws;draws-=discard
    samples=np.array([q[0] for q in chains]);alphas=np.array([q[1] for q in chains])
    import arviz as az
    low_bound,high_bound=feasible_bounds(a,b)
    variable=high_bound>low_bound
    dataset=az.from_dict({'posterior':{'flows':samples[:,:,variable],'alpha':alphas.reshape(2,draws,-1)}})
    rhats=az.rhat(dataset);bulks=az.ess(dataset,method='bulk');tails=az.ess(dataset,method='tail')
    rhat=np.concatenate([rhats[k].values.ravel() for k in rhats])
    bulk=np.concatenate([bulks[k].values.ravel() for k in bulks])
    tail=np.concatenate([tails[k].values.ravel() for k in tails])
    finite=np.all(np.isfinite(rhat)) and np.all(np.isfinite(bulk)) and np.all(np.isfinite(tail))
    rhat_max=float(np.max(rhat)) if finite else None
    ess_min=float(min(np.min(bulk),np.min(tail))) if finite else None
    mean=samples.mean(axis=(0,1));lo,hi=np.quantile(samples,[.025,.975],axis=(0,1))
    low_bound,high_bound=feasible_bounds(a,b)
    assert np.all(samples>=low_bound) and np.all(samples<=high_bound)
    assert np.all(samples.sum(axis=3)==a.sum(axis=0)) and np.all(samples.sum(axis=2)==b.sum(axis=0))
    ppc=np.concatenate([q[2] for q in chains]);ppp=float(np.mean(ppc[:,1]>=ppc[:,0]))
    complete=np.zeros((x.shape[1],y.shape[1]));low=complete.copy();high=complete.copy()
    complete[np.ix_(rows,cols)]=mean;low[np.ix_(rows,cols)]=lo;high[np.ix_(rows,cols)]=hi
    good=finite and rhat_max<=1.01 and ess_min>=400 and .025<=ppp<=.975
    diag={'rhatMax':rhat_max,'essMin':ess_min,'divergences':0,'sampler':'collapsed fixed-margin table MH + lognormal alpha MH',
          'draws':draws,'requestedDraws':requested_draws,'discardedDraws':discard,'tune':tune,'thin':thin,'chains':2,'seed':seed,'priorShape':prior_shape,'priorRate':prior_rate,
          'posteriorPredictiveP':ppp,'alphaAcceptance':[q[3] for q in chains],'maxMarginError':0,'boundsViolations':0}
    failures=assess(diag);diag['failedChecks']=failures;diag['gates']=GATES
    return {'counts':complete.tolist(),'low':low.tolist(),'high':high.tolist(),'diagnostics':diag,
            'status':'estimated' if not failures else 'inconclusive','reason':failures[0] if failures else None}
