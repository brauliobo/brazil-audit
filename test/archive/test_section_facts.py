import csv
import gzip
import io
import json
import pathlib
import sys
import tempfile
import unittest
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[2]/'scripts/archive'))
from section_facts import CandidateLookup, PartitionWriter, vote_record, section_unit, VOTE_TABLE, VOTE_FIELDS, LegacyContext


def raw(**changes):
    row = dict(ANO_ELEICAO='1998',NR_TURNO='1',CD_ELEICAO='1998001',DS_ELEICAO='Eleições Ordinárias - 1998',DT_ELEICAO='04/10/1998',NM_TIPO_ELEICAO='Eleição Ordinária',SG_UF='AC',SG_UE='01120',CD_MUNICIPIO='1120',NR_ZONA='8',NR_SECAO='8',CD_CARGO='3',DS_CARGO='Governador',NR_VOTAVEL='25',NM_VOTAVEL='ALERCIO DIAS',QT_VOTOS='38')
    return {**row,**changes}


class SectionFactsTest(unittest.TestCase):
    def setUp(self):
        self.source=dict(source_url='https://cdn.tse.jus.br/fixture.zip',source_sha256='abc',source_year=1998)
        self.candidate=dict(election_id='1998:1998001:1:1998-10-04',office='3',constituency='ac',number='25',candidate_id='candidate:canonical',name='ALERCIO DIAS')
        self.lookup=CandidateLookup([self.candidate])

    def test_ballot_number_joins_the_office_constituency_not_the_section_ue(self):
        row,method=vote_record(raw(),self.lookup,self.source)
        self.assertEqual(row['candidate_id'],'candidate:canonical')
        self.assertEqual(method,'unambiguous-ballot-number')
        self.assertEqual(row['constituency'],'ac')
        self.assertEqual((row['city_code'],row['zone'],row['section']),('01120','0008','0008'))
        self.assertEqual(row['grain'],'section')
        self.assertEqual(row['votes'],38)

    def test_official_sequence_is_respected_when_present(self):
        lookup=CandidateLookup([{**self.candidate,'source_candidate_id':'1234'}])
        row,method=vote_record(raw(SQ_CANDIDATO='1234'),lookup,self.source)
        self.assertEqual(row['candidate_id'],'candidate:canonical')
        self.assertEqual(method,'official-sequence')
        row,method=vote_record(raw(SQ_CANDIDATO='different'),lookup,self.source)
        self.assertEqual(method,'unmatched-official-sequence')
        self.assertTrue(row['candidate_id'].startswith('unresolved:'))

    def test_different_pleito_and_ambiguous_candidates_never_name_match(self):
        lookup=CandidateLookup([self.candidate,{**self.candidate,'candidate_id':'candidate:other'}])
        row,method=vote_record(raw(),lookup,self.source)
        self.assertEqual(method,'ambiguous-ballot-number')
        self.assertTrue(row['candidate_id'].startswith('unresolved:'))
        row,method=vote_record(raw(CD_ELEICAO='other'),self.lookup,self.source)
        self.assertEqual(method,'unmatched-ballot-number')

    def test_native_blank_null_and_party_list_remain_separate(self):
        for code,kind in [('95','blank'),('96','null_native')]:
            row,_=vote_record(raw(NR_VOTAVEL=code,QT_VOTOS='0'),self.lookup,self.source)
            self.assertEqual(row['kind'],kind)
            self.assertEqual(row['votes'],0)
        row,_=vote_record(raw(CD_CARGO='6',DS_CARGO='Deputado Federal',NR_VOTAVEL='25'),self.lookup,self.source)
        self.assertEqual(row['kind'],'party_list')

    def test_section_turnout_is_observed_and_missing_ballot_total_stays_unknown(self):
        session={'key':'1998'}
        source={**self.source,'source_id':'official'}
        row=section_unit(raw(QT_APTOS='302',QT_COMPARECIMENTO='244',QT_ABSTENCOES='58',QT_VOTOS_NOMINAIS='201',QT_VOTOS_BRANCOS='40',QT_VOTOS_NULOS='3',QT_VOTOS_LEGENDA='0'),session,source)
        self.assertEqual(row['installed'],302)
        self.assertEqual(row['section'],'0008')
        self.assertEqual(row['sections'],1)
        self.assertEqual(row['nominal_reported'],201)
        self.assertIsNone(row['ballots'])
        self.assertIsNone(row['valid'])


    def test_headerless_bridge_uses_the_same_election_geography_and_keeps_reported_br(self):
        with tempfile.TemporaryDirectory() as directory:
            data=pathlib.Path(directory);(data/'history').mkdir()
            fields=['state','city_code']
            with gzip.open(data/'units.csv.gz','wt',encoding='utf8',newline='') as stream:
                writer=csv.writer(stream,lineterminator='\n');writer.writerow(fields);writer.writerow(['rs','88013'])
            event=dict(id='1998:1998001:1:1998-10-04',year=1998,turn=1,sourceDatasetYears=[1998],offices=[{'id':'1'}],sourceElectionIds=['1998001'],dates=['04/10/1998'],parts=[{'url':'units.csv.gz'}])
            (data/'history/indicators.json').write_text(json.dumps({'elections':[event]}))
            context=LegacyContext(data,1998)
            values=['16/02/2016','14:15:12','1998','1','ELEICOES 1998','BR','88013','88013','PORTO ALEGRE','1','195','1','PRESIDENTE','13','245']
            resolved=context.resolve(values)
            self.assertEqual(resolved['SG_UF'],'rs')
            self.assertEqual(resolved['_reported_state'],'BR')
            self.assertEqual(resolved['DT_ELEICAO'],'04/10/1998')
            self.assertEqual(resolved['DT_GERACAO'],'16/02/2016')
            values[7]='99999'
            unknown=context.resolve(values)
            self.assertEqual(unknown['SG_UF'],'')
            row,_=vote_record(unknown,CandidateLookup([]),self.source)
            self.assertIsNone(row['state'])
            self.assertEqual(row['votes'],245)
            self.assertEqual(row['reported_state'],'BR')
            self.assertIn('unresolved-municipality',row['identity_resolution'])
            (data/'history/indicators.json').write_text(json.dumps({'elections':[event,{**event,'id':'another'}]}))
            with self.assertRaisesRegex(ValueError,'ambiguous election'):
                LegacyContext(data,1998).resolve(values)

    def test_interleaved_cities_do_not_finalize_chunks_when_handles_are_evicted(self):
        row,_=vote_record(raw(),self.lookup,self.source)
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory)
            writer=PartitionWriter(root,VOTE_FIELDS,VOTE_TABLE,self.source,max_raw=16*1024*1024,open_limit=2)
            for n in range(1000):writer.write({**row,'city_code':str(1000+n%100).zfill(5),'section':str(n).zfill(4)})
            parts=writer.finish()
            self.assertLessEqual(len(parts),64)
            self.assertEqual(sum(p['rows'] for p in parts.values()),1000)
            self.assertFalse(list(root.rglob('*.wip')))
            for key,p in parts.items():
                self.assertEqual(p['where'],"source_part = '"+key+"'")
                values=list(csv.reader(io.StringIO(gzip.decompress((root/p['url']).read_bytes()).decode())))
                self.assertTrue(all(r[-1]==key for r in values))

    def test_bounded_parts_are_deterministic_and_keep_source_hashes(self):
        row,_=vote_record(raw(),self.lookup,self.source)
        with tempfile.TemporaryDirectory() as directory:
            roots=[pathlib.Path(directory)/name for name in ['a','b']]
            manifests=[]
            for root in roots:
                writer=PartitionWriter(root,VOTE_FIELDS,VOTE_TABLE,self.source,max_raw=500,open_limit=1)
                for i in range(4):writer.write({**row,'section':str(i).zfill(4)})
                parts=writer.finish();self.assertGreater(len(parts),1)
                self.assertEqual(sum(p['rows'] for p in parts.values()),4)
                for part in parts.values():
                    self.assertEqual(part['source_sha256'],'abc')
                    values=list(csv.reader(io.StringIO(gzip.decompress((root/part['url']).read_bytes()).decode())))
                    self.assertEqual(len(values),part['rows'])
                manifests.append({k:p['sha256'] for k,p in parts.items()})
            self.assertEqual(manifests[0],manifests[1])

if __name__=='__main__':unittest.main()
