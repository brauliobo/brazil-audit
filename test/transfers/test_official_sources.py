import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'scripts/transfers'))
import unittest
from official_sources import official_unit

class OfficialOfficeTests(unittest.TestCase):
    def fixture(self):
        return {'e':{'te':'100','esi':'97','esni':'3','c':'80','a':'17'},
                'v':{'vb':'3','vn':'5','vnt':'2','tvn':'7','van':'0','vansj':'5','vsan':'0'},
                'carg':[{'agr':[{'par':[{'cand':[
                    {'n':'13','nm':'A','sqcand':'101','dvt':'Válido','vap':'65'},
                    {'n':'28','nm':'B','sqcand':'102','dvt':'Anulado sub judice','vap':'5'}]}]}]}]}

    def test_invalid_nominal_votes_are_source_categories_not_candidates(self):
        unit=official_unit(self.fixture())
        self.assertNotIn('28',unit['votes'])
        self.assertEqual(unit['votes']['annulled_subjudice'],5)
        self.assertEqual(unit['votes']['null'],7)
        self.assertEqual(sum(unit['votes'].values()),80)
        self.assertEqual(unit['eligible'],100)

    def test_null_decomposition_is_verified_not_selected_to_balance(self):
        source=self.fixture();source['v']['tvn']='8'
        with self.assertRaisesRegex(ValueError,'null-vote decomposition'):official_unit(source)
