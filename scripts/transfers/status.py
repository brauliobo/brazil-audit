"""Predeclared computational and model-adequacy publication gates."""
import math

GATES={'rhatMax':1.01,'essBulkTailMin':400,'predictiveLow':.025,'predictiveHigh':.975,'priorSensitivityPP':10}


def assess(diagnostics):
    if diagnostics.get('identification')=='exact_bounds_collapse':return []
    rhat=diagnostics.get('rhatMax');ess=diagnostics.get('essMin');ppc=diagnostics.get('posteriorPredictiveP')
    failures=[]
    if rhat is None or ess is None or not math.isfinite(rhat) or not math.isfinite(ess) or rhat>GATES['rhatMax'] or ess<GATES['essBulkTailMin']:
        failures.append('nonconvergence')
    if ppc is None or not math.isfinite(ppc) or not GATES['predictiveLow']<=ppc<=GATES['predictiveHigh']:
        failures.append('posterior_predictive_failure')
    return failures
