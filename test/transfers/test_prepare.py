import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'scripts/transfers'))
import unittest
import numpy as np
from prepare import margins


def unit(n,present,absent,installed=None):
    return {'eligible':n,'installed':n if installed is None else installed,'present':present,'absent':absent,'votes':{'13':present},'candidates':{'13':{'label':'Candidate'}}}

class ReconciliationTests(unittest.TestCase):
    def test_minimum_registration_balance_is_distinct_from_abstention(self):
        out=margins({'a':unit(100,80,20)},{'a':unit(101,90,11)})
        self.assertEqual(out['registration']['first'],100)
        self.assertEqual(out['registration']['second'],101)
        self.assertEqual(out['registration']['augmentedPopulation'],101)
        a={q['id']:q['total'] for q in out['from']}
        self.assertEqual(a['administrative_balance'],1)
        self.assertEqual(a['abstention'],20)
        np.testing.assert_array_equal(out['x'].sum(axis=1),out['y'].sum(axis=1))
        self.assertFalse(out['registration']['individualIdentityObserved'])

    def test_strict_scenario_excludes_population_change(self):
        out=margins({'a':unit(100,80,20)},{'a':unit(101,90,11)},'strict-compatible-totals')
        self.assertEqual(out['coverage']['units'],0)
        self.assertEqual(out['coverage']['excluded'][0]['reason'],'population_changed')

    def test_noninstalled_is_an_explicit_source_category(self):
        out=margins({'a':unit(100,80,17,97)},{'a':unit(100,90,7,97)})
        self.assertEqual({q['id']:q['total'] for q in out['from']}['not_installed'],3)

    def test_missing_is_not_zero_and_invalid_ballots_are_not_balanced(self):
        a=unit(100,80,20);a['absent']=None
        out=margins({'a':a},{'a':unit(100,90,10)})
        self.assertEqual(out['coverage']['excluded'][0]['reason'],'missing_turnout_data')
        a=unit(100,80,20);a['votes']['13']=79
        out=margins({'a':a},{'a':unit(100,90,10)})
        self.assertEqual(out['coverage']['excluded'][0]['reason'],'inconsistent_margins')
