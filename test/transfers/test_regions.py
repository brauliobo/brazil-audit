import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'scripts/transfers'))
import unittest
from regions import group_regions

class RegionalTests(unittest.TestCase):
    def test_group_preserves_every_source_count_and_candidate(self):
        crosswalk={('ac','00101'):{'region':'12001'},('ac','00102'):{'region':'12001'}}
        source={('ac','00101'):{'eligible':10,'installed':9,'present':7,'absent':2,'votes':{'13':7},'candidates':{'13':{'label':'A'}}},
                ('ac','00102'):{'eligible':20,'installed':20,'present':15,'absent':5,'votes':{'13':5,'22':10},'candidates':{'22':{'label':'B'}}}}
        grouped,unmapped=group_regions(source,crosswalk)
        self.assertEqual(unmapped,[])
        row=grouped[('ac','12001')]
        self.assertEqual([row[k] for k in ['eligible','installed','present','absent']],[30,29,22,7])
        self.assertEqual(dict(row['votes']),{'13':12,'22':10})
        self.assertEqual(row['municipalities'],['00101','00102'])

    def test_unknown_code_and_unpublished_grain_are_distinct(self):
        source={('ac',''):{'eligible':10},('ac','99999'):{'eligible':20}}
        grouped,missing=group_regions(source,{})
        self.assertEqual(grouped,{})
        self.assertEqual([q['reason'] for q in missing],['source_grain_too_coarse','unmapped_historical_code'])

    def test_missing_count_remains_missing_after_grouping(self):
        source={('ac','00101'):{'eligible':10,'installed':None,'present':None,'absent':None,'votes':{},'candidates':{}}}
        grouped,_=group_regions(source,{('ac','00101'):{'region':'12001'}})
        self.assertIsNone(grouped[('ac','12001')]['present'])
