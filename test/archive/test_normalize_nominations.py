import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parents[2]/'scripts/archive'))
from normalize_nominations import ElectionBindings,normalize,source_rows


class NominationNormalizationTest(unittest.TestCase):
    def setUp(self):
        self.bindings=ElectionBindings(dict(events=[dict(id='event',sourceDatasetYears=[2026],sourceElectionIds=['6257'],dates=['04/10/2026'],
            offices=[dict(key='president')],turn=1,session_key='2026')],sessions=[dict(key='2026',sourceYears=[2026],turn=1,offices=[dict(key='president')])]))

    def test_zero_seats_are_known_and_negative_sentinel_is_not_zero(self):
        raw=dict(ANO_ELEICAO='1933',DESC_ELEICAO='CONSTITUINTE',COD_CARGO='6',DESC_CARGO='DEPUTADO',SIGLA_UF='SP',SIGLA_UE='SP',QTDE_VAGAS='0')
        row=normalize(raw,'election_declared_seats',self.bindings)
        self.assertEqual(row['seats'],0);self.assertIsNone(row['turn']);self.assertIsNone(row['election_id'])
        self.assertEqual(row['office_key'],'historical:6:DEPUTADO');self.assertEqual(row['binding_kind'],'source-context')
        raw['QTDE_VAGAS']='-3';unknown=normalize(raw,'election_declared_seats',self.bindings)
        self.assertIsNone(unknown['seats']);self.assertIn('"-3"',unknown['metric_sentinels'])

    def test_event_without_reported_round_can_bind_only_by_exact_code_date_and_office(self):
        raw=dict(ANO_ELEICAO='2026',CD_ELEICAO='6257',DT_ELEICAO='04/10/2026',CD_CARGO='1',DS_CARGO='PRESIDENTE',QT_VAGA='1')
        row=normalize(raw,'election_declared_seats',self.bindings)
        self.assertEqual(row['election_id'],'event');self.assertIsNone(row['turn'])
        raw['DT_ELEICAO']='25/10/2026'
        self.assertIsNone(normalize(raw,'election_declared_seats',self.bindings)['election_id'])

    def test_headerless_vacancy_layout_and_candidate_sequence_are_source_facts(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'source.zip'
            with zipfile.ZipFile(path,'w') as archive:archive.writestr('CONSULTA_VAGAS_1934_BR.txt','"18/02/2021";"21:51:05";"1934";"ELEIÇÕES 1934";"AM";"AM";"AMAZONAS";"6";"DEPUTADO FEDERAL";"4"\n'.encode('latin1'))
            _,line,raw=next(source_rows(path,'election_declared_seats'));self.assertEqual(line,1)
            self.assertEqual(normalize(raw,'election_declared_seats',self.bindings)['seats'],4)
        raw=dict(ANO_ELEICAO='1933',COD_CARGO='6',DESC_CARGO='DEPUTADO',SEQ_CANDIDATO='99',NOME_CANDIDATO='FONTE',NOME_PARTIDO='PARTIDO SEM SIGLA')
        row=normalize(raw,'candidate_list_links',self.bindings)
        self.assertEqual(row['source_candidate_id'],'99');self.assertIsNone(row['candidate_id'])
        self.assertEqual(row['party_name'],'PARTIDO SEM SIGLA')


if __name__=='__main__':unittest.main()
