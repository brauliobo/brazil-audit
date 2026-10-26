import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'scripts/transfers'))
import unittest
import numpy as np
from scipy.special import gammaln
from engine import feasible_bounds

class ExactTableTests(unittest.TestCase):
    def test_geographical_bounds_are_stricter_than_pooled(self):
        x=np.array([[100,0],[0,100]]);y=np.array([[100,0],[0,100]])
        lo,hi=feasible_bounds(x,y)
        np.testing.assert_array_equal(lo,[[100,0],[0,100]])
        np.testing.assert_array_equal(hi,lo)

if __name__=='__main__':unittest.main()

class CollapsedTests(unittest.TestCase):
    def test_conditional_stationary_law_matches_complete_enumeration(self):
        from hierarchical import collapsed_sweep,collapsed_block_logmass
        alpha=np.array([[2.,3.],[4.,2.]])
        support=np.arange(1,6)
        tables=np.array([[[z,5-z],[6-z,z-1]] for z in support])
        logp=collapsed_block_logmass(tables,alpha)
        probability=np.exp(logp-logp.max());probability/=probability.sum()
        # Parallel independent chains, long enough to remove their initial state.
        t=np.tile(tables[0],(20000,1,1));rng=np.random.default_rng(71)
        for _ in range(25):collapsed_sweep(t,alpha,rng)
        actual=np.array([(t[:,0,0]==z).mean() for z in support])
        np.testing.assert_allclose(actual,probability,atol=.012)

    def test_collapsed_alpha_matches_integrated_dirichlet_multinomial(self):
        from hierarchical import collapsed_alpha_log_density
        from scipy.stats import dirichlet_multinomial,gamma
        alpha=np.array([[2.,3.,4.],[3.,4.,5.]])
        tables=np.array([[[2,3,4],[5,2,1]],[[1,5,2],[1,2,3]]])
        actual=collapsed_alpha_log_density(alpha,tables,4,.5)
        expected=[]
        for i in range(2):
            q=sum(dirichlet_multinomial.logpmf(t[i],alpha[i],t[i].sum()) for t in tables)
            # Remove multinomial coefficients, constant w.r.t alpha.
            q-=sum(gammaln(t[i].sum()+1)-gammaln(t[i]+1).sum() for t in tables)
            q+=gamma.logpdf(alpha[i],4,scale=2).sum()
            expected.append(q)
        constant=3*(4*np.log(.5)-gammaln(4))
        np.testing.assert_allclose(actual+constant,expected)

class DiagnosticTests(unittest.TestCase):
    def test_fixed_by_bounds_requires_no_sampler(self):
        from hierarchical import fit_hierarchical
        from unittest.mock import patch
        with patch('hierarchical.sample_chain',side_effect=AssertionError('must not sample')):
            out=fit_hierarchical([[10,0],[0,20]],[[10,0],[0,20]])
        self.assertEqual(out['diagnostics']['identification'],'exact_bounds_collapse')
        self.assertEqual(out['counts'],[[10,0],[0,20]])

    def test_constant_free_trace_is_not_hidden_as_fixed(self):
        from hierarchical import fit_hierarchical
        from unittest.mock import patch
        chain=(np.tile([[5,5],[5,5]],(500,1,1)),np.ones((500,2,2))*4,np.tile([1.,1.],(500,1)),.5)
        with patch('hierarchical.sample_chain',return_value=chain):
            out=fit_hierarchical([[10,10]],[[10,10]],draws=500,tune=1)
        self.assertEqual(out['status'],'inconclusive')
        self.assertIsNone(out['diagnostics']['rhatMax'])

class CalibrationTests(unittest.TestCase):
    def test_exact_small_table_intervals_cover_prior_generated_heterogeneous_flows(self):
        from hierarchical import collapsed_block_logmass
        rng=np.random.default_rng(19);alpha=np.array([[2.,1.],[1.,2.]])
        covered=0;replicates=400
        for _ in range(replicates):
            truth=np.array([rng.multinomial(10,rng.dirichlet(a)) for a in alpha])
            col=truth.sum(axis=0);support=np.arange(max(0,int(col[0])-10),min(10,int(col[0]))+1)
            tables=np.array([[[z,10-z],[col[0]-z,10-col[0]+z]] for z in support])
            logp=collapsed_block_logmass(tables,alpha);weights=np.exp(logp-logp.max());weights/=weights.sum()
            cdf=weights.cumsum();low=support[np.searchsorted(cdf,.025)];high=support[np.searchsorted(cdf,.975)]
            covered+=low<=truth[0,0]<=high
        self.assertGreaterEqual(covered/replicates,.93)

class CheckpointTests(unittest.TestCase):
    def test_extension_matches_fresh_fixed_segment_run(self):
        from hierarchical import sample_chain
        import os,shutil,tempfile
        current=os.getcwd()
        try:
            with tempfile.TemporaryDirectory() as directory:
                os.chdir(directory)
                x=np.array([[4,6],[6,4]]);y=np.array([[5,5],[4,6]])
                sample_chain(x,y,99,1000,100,thin=1)
                continued=sample_chain(x,y,99,2000,100,thin=1)
                shutil.rmtree('.cache')
                fresh=sample_chain(x,y,99,2000,100,thin=1)
                np.testing.assert_array_equal(continued[0],fresh[0])
                np.testing.assert_array_equal(continued[1],fresh[1])
        finally:os.chdir(current)
