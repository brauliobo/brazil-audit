import copy
import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parents[2]/'scripts/archive'))
from integrate_electoral_facts import fingerprint,merge_offices,election_stages,date_evidence


def registry():
    office=dict(id='1',key='president',name='Presidente',capabilities=dict(metrics={'eligible':{'knownRows':1}},grains=['state'],states=['ac'],tables=['election_units'],rows=1,sectionResults=False,browserRdv=False,times=False))
    return dict(sessions=[dict(key='2002',year=2002,calendarYear=2002,declaredYears=[2002],sourceYears=[2002],date='2002-10-06',turn=1,family='general',eventIds=['units'],offices=[office])],
        events=[dict(id='units',session_key='2002',offices=[dict(id='1',key='president',name='Presidente')])],bindings=[])


def source_event(eid='votes',kind='Eleição Ordinária'):
    return dict(id=eid,year=2002,turn=1,description='Eleição 2002',dates=['06/10/2002'],electionTypes=[kind],sourceElectionIds=['200201'],sourceDatasetYears=[2002],sources=['https://cdn.tse.jus.br/votes.zip'],offices=[dict(id='1',key='president',name='Presidente')])


def observed(eid='votes',office='president'):
    return dict(election_id=eid,office='1',office_key=office,office_name='Presidente',tables=['election_votes','election_candidates'],states=['ac'],grains=['zone'],candidateCounts=True,candidateCount=3,partyMetadata=True)


class FactualRegistryIntegrationTest(unittest.TestCase):
    def test_registration_date_is_not_asserted_as_observed_voting(self):
        r=registry();source=source_event('registration',kind='Eleição Suplementar');o=observed('registration')
        o.update(tables=['candidate_attributes'],grains=[],registeredCount=2,statusKnownCount=0,electedCount=None)
        merge_offices(r,dict(events=[source],eventOffices=[o]));date_evidence(r)
        event=next(e for e in r['events'] if e['id']=='registration')
        session=next(s for s in r['sessions'] if s['key']==event['session_key'])
        self.assertEqual(event['dateEvidence'],'registration-source-reported')
        self.assertEqual(session['dateMeaning'],'source-context-reported')

    def test_reference_only_source_exposes_counts_without_claiming_candidate_votes(self):
        r=registry();r['sessions'][0]['offices'][0]['capabilities'].update(rows=0,metrics={})
        o=observed();o.update(tables=['election_section_units'],grains=['section'],rows=2,metrics={'null_votes':dict(knownRows=2,totalRows=2)})
        merge_offices(r,dict(events=[source_event()],eventOffices=[o]));election_stages(r)
        office=r['sessions'][0]['offices'][0];cap=office['capabilities']
        self.assertEqual(office['electionStage'],'observedData')
        self.assertFalse(cap['sectionResults'])
        self.assertNotIn('observedSections',cap['sources'])
        self.assertEqual(cap['sources']['sectionReference']['metrics']['null_votes']['knownRows'],2)

    def test_2008_registration_context_has_sixty_bijective_candidate_links(self):
        import json
        proof=json.loads((Path(__file__).parents[2]/'data/election-source-bindings.json').read_text())[0]
        links=proof['candidateIdentityLinks']
        self.assertEqual(len(links),60)
        self.assertEqual(len({r['sourceCandidateId'] for r in links}),60)
        self.assertEqual(len({r['targetCandidateId'] for r in links}),60)
        self.assertEqual(proof['sourceElectedRows'],30)
        self.assertTrue(all(r['officeKey']=='mayor' for r in links))

    def test_source_reported_date_context_is_bound_only_with_complete_identity_proof(self):
        r=registry()
        r['sourceContextBindings']=[dict(sourceEventId='votes',targetEventId='units',matched=60,sourceRows=60,unmatchedOrAmbiguous=[])]
        source=source_event();source['dates']=['01/10/2002']
        merge_offices(r,dict(events=[source],eventOffices=[observed()]))
        self.assertEqual(len(r['sessions']),1)
        self.assertEqual(r['sessions'][0]['date'],'2002-10-06')
        self.assertEqual(r['events'][-1]['dates'],['01/10/2002'])
        self.assertTrue(r['events'][-1]['sourceContextOnly'])
        self.assertEqual(r['events'][-1]['canonicalEventId'],'units')
        one=observed('units');one.update(statusKnownCount=60,electedCount=30)
        two=observed('votes');two.update(statusKnownCount=60,electedCount=30)
        merge_offices(r,dict(events=[],eventOffices=[one,two]))
        cap=r['sessions'][0]['offices'][0]['capabilities']
        self.assertEqual(cap['statusKnownCount'],60);self.assertEqual(cap['electedCount'],30)
        r['sourceContextBindings'][0]['matched']=59
        with self.assertRaisesRegex(ValueError,'complete unambiguous'):
            merge_offices(r,dict(events=[],eventOffices=[]))

    def test_registration_only_is_not_zero_elected_results_or_a_date_heuristic(self):
        cap=dict(rows=0,voteRows=0,candidateAttributes=True,registeredCount=2,statusKnownCount=0,electedCount=None)
        r=dict(sessions=[dict(date='1900-01-01',offices=[dict(capabilities=cap)])])
        election_stages(r)
        self.assertEqual(r['sessions'][0]['electionStage'],'registrationOnly')
        self.assertIsNone(cap['electedCount']);self.assertFalse(cap['outcomeKnown'])
        self.assertEqual(cap['registeredCount'],2)

    def test_reported_vice_mayor_outcomes_do_not_require_a_direct_vote_file(self):
        cap=dict(rows=0,voteRows=0,candidateAttributes=True,registeredCount=16326,statusKnownCount=15377,electedCount=5517)
        office=dict(capabilities=cap);r=dict(sessions=[dict(offices=[office])])
        election_stages(r)
        self.assertEqual(cap['electedCount'],5517);self.assertTrue(cap['outcomeKnown'])
        self.assertFalse(office['availability']['counts']);self.assertTrue(office['availability']['reportedOutcomes'])
        self.assertEqual(office['electionStage'],'registrationWithOutcomes')
    def test_source_event_code_remains_distinct_inside_same_known_ordinary_session(self):
        r=merge_offices(registry(),dict(events=[source_event()],eventOffices=[observed()]))
        self.assertEqual(len(r['sessions']),1)
        self.assertEqual(r['sessions'][0]['eventIds'],['units','votes'])
        cap=r['sessions'][0]['offices'][0]['capabilities']
        self.assertEqual(cap['grains'],['state']);self.assertEqual(cap['voteGrains'],['zone'])
        self.assertFalse(cap['sectionResults'])
        self.assertEqual(r['bindings'][0]['election_id'],'votes')
        self.assertNotIn('units',r['bindings'][0]['sources'])

    def test_same_date_does_not_alias_supplementary_contests(self):
        r=merge_offices(registry(),dict(events=[source_event(kind='ELEIÇÃO EXTRAORDINÁRIA')],eventOffices=[observed()]))
        self.assertEqual(len(r['sessions']),2)
        self.assertEqual(r['events'][-1]['session_key'],'e-votes')

    def test_unrepresented_source_event_requires_its_metadata(self):
        with self.assertRaisesRegex(ValueError,'explicit source event metadata'):
            merge_offices(registry(),dict(eventOffices=[observed()]))

    def test_schema_or_part_changes_invalidate_browser_database_version(self):
        a=dict(tables={'units':{'ddl':'v1','parts':{'ac':{'sha256':'one'}}}})
        b=copy.deepcopy(a);b['tables']['units']['ddl']='v2'
        c=copy.deepcopy(a);c['tables']['units']['parts']['ac']['sha256']='two'
        self.assertNotEqual(fingerprint(a),fingerprint(b));self.assertNotEqual(fingerprint(a),fingerprint(c))


if __name__=='__main__':unittest.main()
