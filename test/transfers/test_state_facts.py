import sys,unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'scripts/transfers'))
from state_facts import historical_facts,validate,ROUND_FIELDS,COUNT_FIELDS

class BrowserFactTests(unittest.TestCase):
    def fixture(self,office=3,cities=('00101',)):
        event='2022:546:1:2026-10-04'
        election={event:{'id':event,'turn':1,'description':'Eleição suplementar','electionTypes':['Eleição Extraordinária'],'dates':['04/10/2026']}}
        units={}
        for city in cities:
            meta={'election_id':event,'turn':'1','office':str(office),'state':'ac','city_code':city,'zone':'0001','scope':'zone','date':'04/10/2026','description':'Eleição suplementar',
                  'eligible':'100','installed':'97','present':'80','absent':'17','blank':'3','null':'5','null_technical':'2','annulled':'0','annulled_subjudice':'5','annulled_separate':'0','valid':'65',
                  'source_url':'https://cdn.tse.jus.br/example.zip','source_sha256':'a'*64}
            candidate={'label':'Candidate','fullName':'Candidate','sourceCandidateId':'123','sourceUrl':'https://cdn.tse.jus.br/candidate.zip','sourceSha256':'b'*64}
            units[(event,'ac',city,'0001',str(office))]={'meta':meta,'votes':{'13':65},'candidates':{'13':candidate}}
        return election,units,[]

    def test_uf_ingestion_preserves_sources_population_and_categories(self):
        with patch('state_facts.history_data',return_value=self.fixture(cities=('00101','00102'))):
            rounds,counts=historical_facts(2022,'unused')
        self.assertEqual(len(rounds),1)
        row=dict(zip(ROUND_FIELDS,rounds[0]))
        self.assertEqual((row['year'],row['source_year']),(2026,2022))
        self.assertEqual((row['electorate'],row['present'],row['not_installed']),(200,160,6))
        self.assertTrue(row['votes_complete']);self.assertTrue(row['turnout_complete'])
        self.assertNotIn('electorate',COUNT_FIELDS)
        self.assertEqual(sum(c[COUNT_FIELDS.index('count')] for c in counts),160)
        validate(rounds,counts)

    def test_mayoral_contests_are_not_pooled_within_a_state(self):
        with patch('state_facts.history_data',return_value=self.fixture(11,('00101','00102'))):rounds,counts=historical_facts(2022,'unused')
        self.assertEqual(len(rounds),2)
        self.assertEqual(len(set(r[0] for r in rounds)),2)
        candidates=[dict(zip(COUNT_FIELDS,c))['candidate_id'] for c in counts if c[COUNT_FIELDS.index('candidate_id')] is not None]
        self.assertEqual(len(set(candidates)),2)
        validate(rounds,counts)

    def test_unpublished_candidate_counts_are_not_a_residual_or_zero(self):
        election,units,sources=self.fixture()
        for u in units.values():u['votes']={};u['candidates']={}
        with patch('state_facts.history_data',return_value=(election,units,sources)):rounds,counts=historical_facts(2022,'unused')
        self.assertFalse(dict(zip(ROUND_FIELDS,rounds[0]))['votes_complete'])
        self.assertEqual(len([c for c in counts if c[4].startswith('candidate:')]),0)
        self.assertNotIn('residual',[c[4] for c in counts])

class AvailabilityMetadataTests(unittest.TestCase):
    def test_paired_years_require_both_rounds_of_the_same_contest_and_uf(self):
        from state_facts import paired_years
        def row(contest,state,turn):
            values={k:None for k in ROUND_FIELDS};values.update(contest_id=contest,state=state,turn=turn,year=2026,office=3)
            return [values[k] for k in ROUND_FIELDS]
        self.assertEqual(paired_years([row('a','ac',1),row('b','ac',2),row('a','am',2)]),[])
        self.assertEqual(paired_years([row('a','ac',1),row('a','ac',2)]),[2026])
