import sys
from pathlib import Path
import unittest
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[2] / 'scripts/transfers'))
from engine import estimate, fit_probabilities, feasible_bounds, validate_margins


class TransfersTest(unittest.TestCase):
    def setUp(self):
        rng=np.random.default_rng(7)
        self.x=rng.integers(1,90,size=(80,3))*10
        self.p=np.array([[.8,.1,.1],[.2,.7,.1],[.3,.1,.6]])
        self.y=np.round(self.x @ self.p).astype(int)

    def test_known_homogeneous_flows_recovery_and_conditional_bootstrap(self):
        out=estimate(self.x,self.y,bootstrap=20,seed=12)
        self.assertEqual(out['status'],'estimated')
        np.testing.assert_allclose(out['rowShares'],self.p,atol=1e-3)
        counts=np.array(out['counts'])
        np.testing.assert_allclose(counts.sum(axis=1),self.x.sum(axis=0),atol=.01)
        np.testing.assert_allclose(counts.sum(axis=0),self.y.sum(axis=0),atol=.01)
        self.assertTrue((counts>=np.array(out['boundLow'])-.01).all())
        self.assertTrue((counts<=np.array(out['boundHigh'])+.01).all())
        self.assertEqual(out['diagnostics']['bootstrap'],20)

    def test_retention_is_not_assumed_but_can_be_recovered(self):
        p,d=fit_probabilities(self.x,self.x)
        np.testing.assert_allclose(p,np.eye(3),atol=1e-3)

    def test_abstention_shock_and_blank_null_transitions(self):
        p=np.array([[.6,.1,.1,.1,.1],[.1,.6,.1,.1,.1],[.4,.1,.1,.1,.3]])
        y=np.round(self.x @ p).astype(int)
        out=estimate(self.x,y,bootstrap=20)
        self.assertEqual(out['status'],'estimated')
        np.testing.assert_allclose(out['rowShares'],p,atol=.002)
        self.assertGreater(out['rowShares'][2][0],.39)

    def test_contextual_heterogeneity_rejects_homogeneous_transfer_claims(self):
        x=np.tile(self.x,(2,1)); y=np.vstack([self.x,np.round(self.x @ self.p).astype(int)])
        out=estimate(x,y,bootstrap=20)
        self.assertEqual(out['status'],'inconclusive')
        self.assertEqual(out['reason'],'heterogeneous_behavior')
        self.assertIsNone(out['counts'])
        self.assertGreater(out['diagnostics']['dispersion'],2)

    def test_weak_identification_has_bounds_and_no_point_assignment(self):
        x=np.tile([100,200,300],(30,1)); y=np.tile([200,200,200],(30,1))
        out=estimate(x,y,bootstrap=20)
        self.assertEqual(out['reason'],'rank_deficient')
        self.assertIsNone(out['counts'])
        self.assertEqual(np.shape(out['boundLow']),(3,3))

    def test_zero_rare_category_is_not_invented(self):
        x=np.column_stack([self.x,np.zeros(len(self.x),dtype=int)])
        out=estimate(x,self.y,bootstrap=20)
        self.assertEqual(out['status'],'estimated')
        self.assertEqual(out['counts'][3],[0,0,0])

    def test_population_mismatch_is_rejected_not_balanced(self):
        y=self.y.copy(); y[0,0]+=1
        with self.assertRaisesRegex(ValueError,'incompatible'):
            validate_margins(self.x,y)

    def test_frechet_bounds_are_exact_marginal_constraints(self):
        lo,hi=feasible_bounds([[80,20]],[[60,40]])
        np.testing.assert_array_equal(lo,[[40,20],[0,0]])
        np.testing.assert_array_equal(hi,[[60,40],[20,20]])

if __name__=='__main__':unittest.main()
