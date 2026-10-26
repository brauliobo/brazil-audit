"""Fit one source-prepared contest, checking convergence and prior sensitivity."""
import argparse,hashlib,json,time,fcntl
from pathlib import Path
import numpy as np
from hierarchical import fit_hierarchical
from status import GATES,assess


PROTOCOL=[(60000,2000,0),(150000,6500,1500),(600000,29000,9000),(1000000,49000,9000)]

def fit(ident,cores=2,inputs_root='data/transfers/inputs'):
    target=Path('data/transfers')/f'{ident}.json'
    output=json.loads(target.read_text())
    data=np.load(Path(inputs_root)/f'{ident}.npz');x,y=data['x'],data['y']
    output['diagnostics']['inputSha256']=hashlib.sha256(x.tobytes()+y.tobytes()).hexdigest()
    results=[]
    for name,shape,rate in [('primary',4,.5),('doubled-prior-variance',2,.25)]:
        cache=Path('.cache/transfers-fits');cache.mkdir(exist_ok=True)
        for sweeps,draws,discard in PROTOCOL:
            tune=20000;thin=20
            fingerprint=hashlib.sha256((output['diagnostics']['inputSha256']+json.dumps([draws,tune,thin,shape,rate,discard])+Path(__file__).with_name('hierarchical.py').read_text()+Path(__file__).with_name('sampler.py').read_text()+Path(__file__).with_name('status.py').read_text()).encode()).hexdigest()
            path=cache/f'{ident}-{name}-{fingerprint}.json'
            if path.exists():result=json.loads(path.read_text())
            else:
                start=time.monotonic()
                result=fit_hierarchical(x,y,draws=draws,tune=tune,thin=thin,prior_shape=shape,prior_rate=rate,cores=cores,discard=discard)
                result['diagnostics']['seconds']=time.monotonic()-start
                result['diagnostics']['protocolSweeps']=sweeps
                path.write_text(json.dumps(result,allow_nan=False)+'\n')
            print(ident,name,sweeps,result['status'],result['diagnostics'],flush=True)
            if result['status']=='estimated':break
        results.append(result)
        print(ident,name,result['status'],result['diagnostics'],flush=True)
    primary,alternative=results
    shares=np.array(primary['counts'])/x.sum(axis=0)[:,None]
    alternative_shares=np.array(alternative['counts'])/x.sum(axis=0)[:,None]
    sensitivity={'alternativeShape':2,'alternativeRate':.25,'samePriorMean':8,'varianceMultiplier':2,
                 'maxRowShareChange':float(np.max(np.abs(shares-alternative_shares))),
                 'alternativeStatus':alternative['status'],'alternativeDiagnostics':alternative['diagnostics']}
    converged=primary['status']=='estimated' and alternative['status']=='estimated'
    sensitivity['status']='evaluated' if converged else 'not_evaluable'
    if not converged:sensitivity['maxRowShareChange']=None
    prior_sensitive=converged and sensitivity['maxRowShareChange']>GATES['priorSensitivityPP']/100
    good=converged and not prior_sensitive
    # Sensitivity is disclosed quantitatively, not used as a declaration that
    # 95% intervals have frequentist coverage or that an individual flow is known.
    output['diagnostics']['protocol']={'stages':[q[0] for q in PROTOCOL],'rhatMax':1.01,'essBulkTailMin':400,'priorSensitivityThresholdPP':10}
    output['diagnostics'].update(primary['diagnostics']);output['diagnostics']['priorSensitivity']=sensitivity
    output['status']='estimated' if good else 'inconclusive'
    output['reason']=None if good else ('prior_sensitive' if converged and prior_sensitive else (primary['reason'] if primary['status']!='estimated' else alternative['reason']))
    for label,result in [('primary',primary),('doubled-prior-variance',alternative)]:
        output['models'].append({'id':label,'status':result['status'],'reason':result['reason'],'diagnostics':result['diagnostics'],
                                 'counts':result['counts'] if result['status']=='estimated' else None,'low':result['low'] if result['status']=='estimated' else None,'high':result['high'] if result['status']=='estimated' else None})
    estimates=np.array(primary['counts']);lower=np.array(primary['low']);upper=np.array(primary['high'])
    for i,a in enumerate(output['from']):
        for j,b in enumerate(output['to']):
            cell=output['cells'][i*len(output['to'])+j]
            cell.update(estimate=float(estimates[i,j]) if good else None,rowShare=float(shares[i,j]) if good else None,
                        low=float(lower[i,j]) if good else None,high=float(upper[i,j]) if good else None)
    target.write_text(json.dumps(output,ensure_ascii=False,separators=(',',':'),allow_nan=False)+'\n')
    indexpath=Path('data/transfers/index.json')
    with Path('.cache/transfers-index.lock').open('w') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        index=json.loads(indexpath.read_text())
        for contest in index['contests']:
            if contest['id']==ident:contest.update(status=output['status'],reason=output['reason'],sha256=hashlib.sha256(target.read_bytes()).hexdigest(),bytes=target.stat().st_size)
        indexpath.write_text(json.dumps(index,ensure_ascii=False,indent=2)+'\n')
    return output


def main():
    p=argparse.ArgumentParser();p.add_argument('contest');p.add_argument('--cores',type=int,choices=[1,2],default=2);p.add_argument('--inputs-root',default='data/transfers/inputs')
    a=p.parse_args();fit(a.contest,a.cores,a.inputs_root)

if __name__=='__main__':main()
