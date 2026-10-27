import json
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parents[2]/'scripts/archive'))
from browser_catalog import update


class BrowserCatalogTest(unittest.TestCase):
    def test_raw_rdv_count_relation_does_not_claim_full_binary_normalization(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/'history').mkdir()
            (root/'history/indicators.json').write_text('{"elections":[]}')
            (root/'history/catalog.json').write_text(json.dumps(dict(datasets=[dict(id='rdv',family='rdv',inScope=True,years=[2024],resources=[],releaseUrl='https://example.org/raw-rdv')])) )
            fragment=root/'facts.json';fragment.write_text(json.dumps(dict(tables={'election_section_votes':dict(parts={'known':dict(sourceYears=[2024],rows=9)})})))
            update(root,dict(events=[],sessions=[]),[fragment])
            row=json.loads((root/'history/catalog.json').read_text())['datasets'][0]
            self.assertNotIn('browserNormalized',row)
            self.assertFalse(row['browserDataEquivalent']['fullCollectionNormalized'])
            self.assertFalse(row['browserDataEquivalent']['completeMemberLevelEquivalence'])

    def test_profile_availability_uses_existing_year_context_without_claiming_complete_archive(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/'history').mkdir();(root/'profiles').mkdir()
            profile='https://cdn.tse.jus.br/profile1994.zip';other='https://cdn.tse.jus.br/unparsed.zip'
            catalog=dict(datasets=[dict(id='profile',years=[1994],normalized=False,resources=[dict(url=profile),dict(url=other)])])
            (root/'history/catalog.json').write_text(json.dumps(catalog))
            (root/'history/indicators.json').write_text(json.dumps(dict(elections=[])))
            (root/'profiles/index.json').write_text(json.dumps(dict(datasets=[dict(sourceUrl=profile,years=[1994])])))
            registry=dict(events=[],sessions=[dict(key='1994',year=1994,date='1994-10-03')])
            update(root,registry,[])
            actual=json.loads((root/'history/catalog.json').read_text())['datasets'][0]
            self.assertFalse(actual['normalized'])
            self.assertEqual(actual['browserNormalized']['scope'],'selected-facts')
            self.assertEqual(actual['browserNormalized']['sessionKey'],'1994')
            self.assertEqual(actual['browserNormalized']['context'],'independent-profile-snapshot')
            self.assertNotIn('browserNormalized',actual['resources'][1])
            self.assertEqual(actual['browserNormalized']['tables'],['election_profiles'])


if __name__=='__main__':unittest.main()
