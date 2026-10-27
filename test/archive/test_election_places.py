import json
import sys
import unittest
from collections import defaultdict
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parents[2]/'scripts/archive'))
from election_places import collapse


class ElectoralPlacesTest(unittest.TestCase):
    def test_duplicate_source_offices_do_not_duplicate_the_geographic_join(self):
        key=('2018','ac','01392');base=dict(city_name='RIO BRANCO',source_url='https://cdn.tse.jus.br/detail.zip',source_sha256='a'*64,source_year=2018)
        rows={key:[dict(base,election_id='pres'),dict(base,election_id='gov'),dict(base,election_id='gov')]}
        result=collapse(rows)
        self.assertEqual(len(result),1)
        self.assertEqual(result[key]['city_name'],'RIO BRANCO')
        self.assertEqual(json.loads(result[key]['source_election_ids']),['gov','pres'])
        self.assertEqual(len(json.loads(result[key]['provenance'])),2)
        self.assertIsNone(result[key]['election_id'])

    def test_source_spelling_variants_are_preserved_without_current_name_lookup(self):
        key=('2018','to','96910');base=dict(election_id='source',source_url='https://cdn.tse.jus.br/detail.zip',source_sha256='a'*64,source_year=2018)
        result=collapse({key:[dict(base,city_name='FORTALEZA DO TABOCÃO'),dict(base,city_name='Fortaleza do Tabocão')]})[key]
        self.assertEqual(set(json.loads(result['name_variants'])),{'FORTALEZA DO TABOCÃO','Fortaleza do Tabocão'})
        self.assertNotEqual(result['city_name'],'TABOCÃO')


if __name__=='__main__':unittest.main()
