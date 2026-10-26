import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'scripts/transfers'))
import unittest
from status import assess

class PublicationGateTests(unittest.TestCase):
    def test_convergence_does_not_override_poor_predictive_fit(self):
        self.assertEqual(assess({'rhatMax':1.001,'essMin':800,'posteriorPredictiveP':.995}),['posterior_predictive_failure'])

    def test_distinct_failures_are_preserved(self):
        self.assertEqual(assess({'rhatMax':1.026,'essMin':325,'posteriorPredictiveP':.995}),['nonconvergence','posterior_predictive_failure'])

    def test_no_tolerance_for_nearly_passing_result(self):
        self.assertEqual(assess({'rhatMax':1.0112,'essMin':379,'posteriorPredictiveP':.78}),['nonconvergence'])
