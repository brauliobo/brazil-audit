import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'scripts/transfers'))
import unittest
from canonical import canonical_records


def record(scope,n,city='',zone=''):
    return {'election_id':'2026:6258:2:2026-10-25','office':'1','scope':scope,'state':'ac',
            'city_code':city,'zone':zone,'eligible':str(n),'installed':str(n),'present':str(n),'absent':'0'}

class CanonicalSourceTests(unittest.TestCase):
    def test_complete_rollups_are_selected_once_at_the_finest_grain(self):
        rows=[record('state',30),record('municipality',30,'00101'),record('zone',10,'00101','0001'),record('zone',20,'00101','0002')]
        chosen=canonical_records(rows)
        self.assertEqual(len(chosen),2)
        self.assertEqual(sum(int(r['eligible']) for r in chosen),30)
        self.assertTrue(all(r['scope']=='zone' for r in chosen))

    def test_partial_or_inconsistent_rollups_are_not_summed_or_hidden(self):
        with self.assertRaisesRegex(ValueError,'rollups disagree'):
            canonical_records([record('state',30),record('municipality',29,'00101')])

    def test_duplicate_territorial_identity_is_rejected(self):
        with self.assertRaisesRegex(ValueError,'duplicate zone'):
            canonical_records([record('zone',10,'00101','0001'),record('zone',10,'00101','0001')])

    def test_2026_has_one_owning_source_profile(self):
        from build import build_year
        from unittest.mock import patch
        with patch('build.build_2026',return_value=['official']) as official,patch('build.build_history',side_effect=AssertionError('must not read overlapping history')):
            self.assertEqual(build_year(2026,'unused'),['official'])
        official.assert_called_once_with()
