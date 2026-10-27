import json
import sys
import unittest
import tempfile
import gzip
import csv
from collections import defaultdict
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parents[2]/'scripts/archive'))
from election_places import collapse,merge_descriptors,rebind_source_contexts,FIELDS


class ElectoralPlacesTest(unittest.TestCase):
    def test_proven_context_rebinding_preserves_names_without_orphan_partitions(self):
        with tempfile.TemporaryDirectory() as directory:
            data=Path(directory);(data/'places').mkdir();(data/'places/index.json').write_text('{}')
            registry=dict(sessions=[dict(key='reported')],events=[dict(id='reported-event',session_key='reported')])
            manifest=dict(tables={'election_places':dict(parts={})})
            row=dict(election_id='reported-event',state='mg',city_code='43710',city_name='CONTAGEM',
                source_url='https://cdn.tse.jus.br/candidates.zip',source_sha256='a'*64,source_year=2008)
            merge_descriptors(data,registry,manifest,[row])
            old=data/'places/reported/mg.csv.gz'
            registry['sessions']=[dict(key='canonical')]
            registry['events'][0].update(session_key='canonical',sourceContextOnly=True)
            rebind_source_contexts(data,registry,manifest)
            self.assertFalse(old.exists())
            self.assertEqual(list(manifest['tables']['election_places']['parts']),['canonical/mg'])
            with gzip.open(data/'places/canonical/mg.csv.gz','rt') as stream:
                result=next(csv.DictReader(stream,fieldnames=FIELDS))
            self.assertEqual(result['source_election_ids'],'["reported-event"]')
            self.assertEqual(result['city_name'],'CONTAGEM')

    def test_native_event_descriptor_adds_a_name_without_duplicating_existing_rows(self):
        with tempfile.TemporaryDirectory() as directory:
            data=Path(directory);(data/'places').mkdir();(data/'places/index.json').write_text('{}')
            registry=dict(events=[dict(id='fn',session_key='fn-session')])
            manifest=dict(tables={'election_places':dict(parts={})})
            row=dict(election_id='fn',state='pe',city_code='30015',city_name='FERNANDO DE NORONHA',
                source_url='https://cdn.tse.jus.br/pe.zip',source_sha256='a'*64,source_year=2022)
            merge_descriptors(data,registry,manifest,[row])
            part=manifest['tables']['election_places']['parts']['fn-session/pe'];first=part['sha256']
            merge_descriptors(data,registry,manifest,[row])
            self.assertEqual(first,manifest['tables']['election_places']['parts']['fn-session/pe']['sha256'])
            with gzip.open(data/part['url'],'rt',newline='') as stream:
                actual=list(csv.DictReader(stream,fieldnames=FIELDS))
            self.assertEqual(len(actual),1);self.assertEqual(actual[0]['city_name'],'FERNANDO DE NORONHA')
            self.assertEqual(actual[0]['source_election_ids'],'["fn"]')

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
