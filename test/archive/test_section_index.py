import hashlib
import json
import pathlib
import sys
import tempfile
import unittest
from collections import Counter
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[2]/'scripts/archive'))
from check_section_overlap import compare
from index_section_facts import build

class SectionIndexTest(unittest.TestCase):
    def test_overlap_proof_requires_equal_full_keys_and_counts(self):
        self.assertEqual(compare(Counter({('one',):3}),Counter({('one',):3}))['votes'],3)
        with self.assertRaises(ValueError):compare(Counter({('one',):3}),Counter({('other',):3}))
        with self.assertRaises(ValueError):compare(Counter({('one',):3}),Counter({('one',):4}))

    def test_new_explicit_event_is_emitted_instead_of_rejected_by_closed_registry(self):
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory);raw=root/'raw';packed=root/'packed'
            (raw/'sources').mkdir(parents=True);(packed/'sources').mkdir(parents=True)
            url='https://cdn.tse.jus.br/estatistica/sead/odsele/detalhe_votacao_secao/detalhe_votacao_secao_2022.zip'
            eid='2022:548:1:2022-10-02';office='historical:25:CONSELHEIRO DISTRITAL'
            event=dict(id=eid,year=2022,turn=1,dates=['02/10/2022'],offices=[dict(id='25',key=office,name='Conselheiro Distrital')])
            table=dict(name='election_section_units',columns='election_id',ddl='create table election_section_units (election_id text)',parts={'part':dict(url='part.csv.gz',electionIds=[eid],officeKeys=[office],states=['pe'],grains=['section'])})
            original=dict(status='ready',referenceMemberSelection={'version':1},source=dict(source_url=url,source_sha256='source',source_year=2022),rows=1,table=table,events=[event],places=[dict(election_id=eid,state='pe',city_code='30015',city_name='FERNANDO DE NORONHA')])
            content=json.dumps(original).encode();key=hashlib.sha256(url.encode()).hexdigest()
            (raw/'sources'/f'{key}.json').write_bytes(content)
            transport={**original,'inputSha256':hashlib.sha256(content).hexdigest(),'observedCoverage':[dict(election_id=eid,office='25',office_key=office,state='pe',sections=1,counts={'nominal_reported':100})]}
            (packed/'sources'/f'{key}.json').write_text(json.dumps(transport))
            (root/'catalog.json').write_text(json.dumps({'datasets':[{'resources':[dict(id='source',url=url)]}]}))
            (root/'registry.json').write_text(json.dumps({'events':[]}))
            result=build(raw,packed,root/'catalog.json',root/'registry.json')
            self.assertEqual(result['status'],'ready')
            self.assertEqual(result['unregisteredEvents'],[])
            self.assertEqual(result['events'][0]['id'],eid)
            self.assertEqual(result['places'][0]['city_name'],'FERNANDO DE NORONHA')
            self.assertEqual(result['eventOffices'][0]['office_name'],'Conselheiro Distrital')
            self.assertFalse(result['eventOffices'][0]['browserRdv'])
            original.pop('referenceMemberSelection')
            (raw/'sources'/f'{key}.json').write_text(json.dumps(original))
            blocked=build(raw,packed,root/'catalog.json',root/'registry.json')
            self.assertEqual(blocked['status'],'preparing')
            self.assertEqual(blocked['tables'],{},'an old ready record cannot publish unreconciled references')

if __name__=='__main__':unittest.main()
