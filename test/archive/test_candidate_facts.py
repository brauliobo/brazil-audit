import importlib.util
from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'scripts/archive'))
from candidate_facts import candidate_record, election_identity, legacy_rows, party_record

class CandidateFactsTest(unittest.TestCase):
    def row(self, **kw):
        return dict(ANO_ELEICAO='2000',CD_ELEICAO='2000001',NR_TURNO='1',DT_ELEICAO='01/10/2000',DS_ELEICAO='ELEIÇÕES',SG_UF='SP',SG_UE='71072',CD_MUNICIPIO='71072',NR_ZONA='1',CD_CARGO='11',DS_CARGO='Prefeito',SQ_CANDIDATO='41',NR_CANDIDATO='15',NM_CANDIDATO='Nome',NM_URNA_CANDIDATO='Urna',NR_PARTIDO='15',SG_PARTIDO='PMDB',QT_VOTOS_NOMINAIS_VALIDOS='10',**kw)
    def test_municipal_candidate_ids_are_scoped(self):
        a=candidate_record(self.row(),{})
        b=self.row();b['SG_UE']='12345';b['CD_MUNICIPIO']='12345'
        self.assertNotEqual(a[1]['candidate_id'],candidate_record(b,{})[1]['candidate_id'])
    def test_supplementary_dates_separate_ids(self):
        a=self.row();b=self.row();b['DT_ELEICAO']='02/10/2000'
        self.assertNotEqual(election_identity(a,{}),election_identity(b,{}))
    def test_native_valid_count_and_unknown_status(self):
        v,c=candidate_record(self.row(),{})
        self.assertEqual(v['votes'],10);self.assertIsNone(c['status']);self.assertEqual(c['party'],'PMDB')
    def test_1933_keeps_constituent_and_undated_turn(self):
        r={'ANO_ELEICAO':'1933','NUM_TURNO':'1','DESC_ELEICAO':'CONSTITUINTE','SIGLA_UF':'AC','SIGLA_UE':'AC','COD_CARGO':'6','DESC_CARGO':'DEPUTADO','NUMERO_CAND':'-3','SEQ_CANDIDATO':'-3','NOME_CANDIDATO':'ALBERTO','NOME_URNA_CAND':'#NE#','TOTAL_VOTOS':'948'}
        lookup={('1933','CONSTITUINTE'):[{'id':'1933:legacy:na','turn':None}]}
        v,c=candidate_record(r,lookup)
        self.assertEqual(v['election_id'],'1933:legacy:na');self.assertEqual(v['office_key'],'historical:6:DEPUTADO');self.assertIsNone(c['number']);self.assertEqual(c['short_name'],'ALBERTO')
    def test_party_list_is_not_nominal_votes(self):
        r=self.row();r['QT_VOTOS_NOMINAIS_VALIDOS']='900';r['QT_TOTAL_VOTOS_LEG_VALIDOS']='12'
        v,c=party_record(r,{})
        self.assertEqual(v['kind'],'party_list');self.assertEqual(v['votes'],12)
    def test_unknown_party_count_is_null(self):
        self.assertIsNone(party_record(self.row(),{})[0]['votes'])

if __name__=='__main__':unittest.main()

class CandidateAttributesTest(unittest.TestCase):
    def test_whitelist_omits_private_fields_and_exact_birth(self):
        from candidate_attributes import attribute_record
        raw=CandidateFactsTest().row();raw.update(DT_NASCIMENTO='02/10/1970',DS_GENERO='FEMININO',DS_COR_RACA='PARDA',NR_CPF_CANDIDATO='private',NR_TITULO_ELEITORAL_CANDIDATO='private',DS_EMAIL='private')
        r=attribute_record(raw,{},{});self.assertEqual(r['age_band'],'25–34');self.assertEqual(r['gender'],'FEMININO')
        self.assertFalse(any('private'==v for v in r.values()));self.assertNotIn('DT_NASCIMENTO',r)

class StateConstituencyTest(unittest.TestCase):
    def test_governor_source_ue_can_be_reporting_municipality(self):
        a=CandidateFactsTest().row();a.update(CD_CARGO='3',DS_CARGO='Governador',SG_UE='61018',CD_MUNICIPIO='61018',SQ_CANDIDATO='5513')
        b=dict(a,SG_UE='61034',CD_MUNICIPIO='61034')
        x=candidate_record(a,{})[1];y=candidate_record(b,{})[1]
        self.assertEqual(x['candidate_id'],y['candidate_id']);self.assertEqual(x['constituency'],'sp');self.assertEqual(x['source_candidate_id'],'5513')

class SourceMembersTest(unittest.TestCase):
    def test_national_export_retains_all_offices_without_territorial_duplicates(self):
        from candidate_facts import source_members
        self.assertEqual(source_members(['votes_AC.csv','votes_BR.csv','votes_BRASIL.csv','leiame.pdf']),['votes_BRASIL.csv'])
        self.assertEqual(source_members(['votes_AC.TXT','votes_BR.TXT','leiame.pdf']),['votes_AC.TXT','votes_BR.TXT'])
    def test_native_valid_column_is_not_replaced_by_reported_zero(self):
        raw=CandidateFactsTest().row();raw['QT_VOTOS_NOMINAIS']='0';raw['QT_VOTOS_NOMINAIS_VALIDOS']='193081'
        self.assertEqual(candidate_record(raw,{})[0]['votes'],193081)

class CanonicalSourceRegressionTest(unittest.TestCase):
    def test_real_1998_native_ac_president_and_governor(self):
        import csv
        from collections import Counter
        totals=Counter();counts=Counter()
        with (Path(__file__).parent/'fixtures/candidate-1998-ac.csv').open() as f:
            for row in csv.DictReader(f):
                v,c=candidate_record(row,{})
                self.assertEqual(v['destination'],'valid');totals[v['office']]+=v['votes'];counts[v['office']]+=1
        self.assertEqual(totals,{'1':193081,'3':195645});self.assertEqual(counts,{'1':286,'3':96})
    def test_unknown_1934_councillor_jurisdiction_keeps_distinct_source_records(self):
        raw={'ANO_ELEICAO':'1934','NUM_TURNO':'1','DESC_ELEICAO':'ELEIÇÕES 1934','SIGLA_UF':'DF','SIGLA_UE':'DF','COD_CARGO':'8','DESC_CARGO':'VEREADOR','NUMERO_CAND':'-3','SEQ_CANDIDATO':'-3','NOME_CANDIDATO':'Nome igual','TOTAL_VOTOS':'10'}
        source={'source_url':'https://example.org/source.zip','source_sha256':'a'*64,'source_member':'source.txt','source_row':2}
        a,c=candidate_record(raw,{},source);b,d=candidate_record(raw,{},dict(source,source_row=3))
        self.assertNotEqual(a['candidate_id'],b['candidate_id']);self.assertIsNone(a['constituency']);self.assertEqual(c['identity_status'],'context_unresolved')
        from candidate_facts import office_jurisdiction
        self.assertEqual(office_jurisdiction('councillor'),'municipality');self.assertEqual(office_jurisdiction('district_deputy'),'state')

class SourceRepresentationTest(unittest.TestCase):
    def test_whole_country_source_includes_presidency_without_repeating_uf_extracts(self):
        from source_members import source_members
        self.assertEqual(source_members(['UF_AC.csv','BRASIL.csv']),['BRASIL.csv'])
        self.assertEqual(source_members(['UF_AC.TXT','UF_BR.TXT']),['UF_AC.TXT','UF_BR.TXT'])
    def test_exact_missing_alias_does_not_discard_text_or_change_nomination_identity(self):
        from candidate_facts import clean,candidate_record
        self.assertIsNone(clean('#NULO'))
        self.assertIsNone(clean('#NULO#'))
        self.assertEqual(clean('#NULO posterior'),'#NULO posterior')
        r=CandidateFactsTest().row();r['DS_SIT_TOT_TURNO']='#NULO'
        before=candidate_record(r,{})[1]['candidate_id']
        r['DS_SIT_TOT_TURNO']='ELEITO'
        self.assertEqual(candidate_record(r,{})[1]['candidate_id'],before)
