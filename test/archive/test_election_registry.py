import csv
import gzip
import io
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[2] / 'scripts/archive'))
from build_election_registry import UNIT_FIELDS, session_groups, unit_row, table_definition, constituency_grain


def event(ident, office='president', code='1', year=2026, turn=1, date='04/10/2026', kind='Eleição Ordinária'):
    return dict(id=ident, year=year, turn=turn, dates=[date] if date else [], electionTypes=[kind] if kind else [],
                sourceElectionIds=[code], offices=[dict(id='1', key=office, name=office)])


class ElectionRegistryTest(unittest.TestCase):
    def test_constituency_uses_source_office_meaning_not_reused_numeric_id(self):
        self.assertEqual(constituency_grain(dict(id='11',key='mayor',name='Prefeito'),event('x')), 'municipality')
        self.assertEqual(constituency_grain(dict(id='25',key='historical:25:CONSELHEIRO DISTRITAL',name='Conselheiro Distrital'),event('x')), 'municipality')
        self.assertEqual(constituency_grain(dict(id='6',key='historical:6:',name=''),event('x')), 'unknown')
        self.assertEqual(constituency_grain(dict(id='1',key='president',name='Presidente'),event('x')), 'national')
    def test_modern_presidential_and_statewide_events_share_one_existing_url(self):
        groups = session_groups([event('p', code='6257'), event('g', office='governor', code='6259')])
        self.assertEqual([(k, [e['id'] for e in es], alias) for k, es, alias in groups], [('2026', ['p', 'g'], '2026')])

    def test_council_election_does_not_join_general_election_on_same_date(self):
        groups = session_groups([event('p', code='295', year=2018, date='07/10/2018'),
                                 event('fn', office='historical:25:CONSELHEIRO DISTRITAL', code='339', year=2018, date='07/10/2018')])
        self.assertEqual({key for key, _, _ in groups}, {'2018', 'e-fn'})

    def test_supplementary_events_keep_separate_identity_on_same_date(self):
        a = event('a', 'mayor', code='6269', kind='Eleição Extraordinária')
        b = event('b', 'mayor', code='6270', kind='Eleição Extraordinária')
        self.assertEqual(len(session_groups([a, b])), 2)

    def test_legacy_null_round_and_missing_date_are_not_invented(self):
        e = event('1933:legacy:na', 'historical:6:DEPUTADO', year=1933, turn=None, date=None, kind=None)
        key, members, alias = session_groups([e])[0]
        self.assertIsNone(members[0]['turn']); self.assertEqual(members[0]['dates'], [])
        self.assertIsNone(alias); self.assertEqual(key, '1933')

    def test_conflicting_general_office_events_remain_distinct(self):
        groups = session_groups([event('a', year=2010, code='a'), event('b', year=2010, code='b')])
        self.assertEqual(len(groups), 2)

    def test_converted_unit_preserves_unknowns_zero_and_source_year(self):
        row = dict(year='2022', date='21/06/2026', turn='1', scope='state', state='ac',
                   null='0', eligible='100', present='', office_key='governor')
        result = unit_row(row, {'key': 'supplementary'})
        self.assertEqual((result['year'], result['source_year'], result['date']), (2026, 2022, '2026-06-21'))
        self.assertEqual(result['null_votes'], 0)
        self.assertIsNone(result['present']); self.assertIsNone(result['section']); self.assertIsNone(result['city_code'])
        self.assertEqual(result['grain'], 'state')

    def test_typed_numeric_zero_matches_the_same_csv_zero(self):
        base=dict(year=2022,date='',turn=1,scope='state',state='ac',eligible=0,installed=0,present=0,absent=0,null=0,blank=0)
        typed=unit_row(base,{'key':'source'})
        text=unit_row({k:str(v) if isinstance(v,int) else v for k,v in base.items()},{'key':'source'})
        for field in ['eligible','installed','present','absent','null_votes','blank']:
            self.assertEqual(typed[field],0);self.assertEqual(typed[field],text[field])

    def test_schema_has_real_election_identity_and_explicit_null_votes(self):
        table = table_definition({})
        self.assertIn('election_id text', table['ddl']); self.assertIn('null_votes bigint', table['ddl'])
        self.assertEqual(len(UNIT_FIELDS), len(set(UNIT_FIELDS)))
        self.assertNotIn('null bigint', table['ddl'])
        self.assertEqual(table['metricDefinitions']['nominal']['countMeaning'], 'nominal_valid')
        self.assertFalse(table['metricDefinitions']['ballots']['isAttendance'])
        self.assertFalse(table['metricDefinitions']['sections']['isGrain'])


class GeneratedRegistryTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = Path(__file__).parents[2] / 'data'
        cls.registry = json.loads((cls.data / 'elections.json').read_text())
        cls.index = json.loads((cls.data / 'history/indicators.json').read_text())
        cls.manifest = json.loads((cls.data / 'manifest.json').read_text())

    def test_every_source_event_resolves_exactly_once(self):
        source = {e['id'] for e in self.index['elections']}
        registered = [e for s in self.registry['sessions'] for e in s['eventIds']]
        self.assertTrue(source.issubset(set(registered)))
        self.assertEqual(set(registered), {e['id'] for e in self.registry['events']})
        self.assertEqual(len(registered), len(set(registered)))
        fragment = self.data / 'results-facts/index.json'
        if fragment.exists():
            candidates = json.loads(fragment.read_text())
            self.assertTrue({e.get('id',e.get('election_id')) for e in candidates['events']}.issubset(set(registered)))
        self.assertEqual(len({s['key'] for s in self.registry['sessions']}), len(self.registry['sessions']))

    def test_1933_1989_municipal_and_actual_supplementary_year(self):
        events = {e['id']: e for e in self.registry['events']}
        first = next(e for e in events.values() if e['year'] == 1933)
        self.assertIsNone(first['turn']); self.assertEqual(first['grains'], ['state'])
        self.assertEqual(first['offices'][0]['key'], 'historical:6:DEPUTADO')
        self.assertEqual({e['turn'] for e in events.values() if e['year'] == 1989}, {1, 2})
        municipal = next(s for s in self.registry['sessions'] if '2000:2000001:1:2000-10-01' in s['eventIds'])
        self.assertTrue({'mayor', 'councillor'}.issubset({o['key'] for o in municipal['offices']}))
        sup = next(s for s in self.registry['sessions'] if '2022:6278:1:2026-06-21' in s['eventIds'])
        self.assertEqual((sup['calendarYear'], sup['declaredYears']), (2026, [2022]))

    def test_modern_six_urls_preserved_and_all_offices_bound(self):
        sessions = {s['key']: s for s in self.registry['sessions']}
        for key in ['2018', '2018-2', '2022', '2022-2', '2026', '2026-2']:
            self.assertEqual(sessions[key]['legacyKey'], key)
            self.assertEqual(len(sessions[key]['eventIds']), 2)
        self.assertTrue({'president','governor','senator','federal_deputy','state_deputy','district_deputy'}.issubset({o['key'] for o in sessions['2026']['offices']}))
        self.assertTrue({'president', 'governor'}.issubset({o['key'] for o in sessions['2026-2']['offices']}))
        for key in ['2026','2026-2']:
            bound={b['office_key'] for b in self.registry['bindings'] if b['session_key']==key}
            self.assertEqual(bound,{o['key'] for o in sessions[key]['offices']})

    def test_fact_partition_retains_original_grain_and_source_values(self):
        first = next(e for e in self.index['elections'] if e['year'] == 1933)
        with gzip.open(self.data / first['parts'][0]['url'], 'rt') as stream:
            original = next(csv.DictReader(stream))
        s = next(s for s in self.registry['sessions'] if first['id'] in s['eventIds'])
        p = self.manifest['tables']['election_units']['parts'][f"{s['key']}/{original['state']}"]
        with gzip.open(self.data / p['url'], 'rt') as stream:
            row = dict(zip(UNIT_FIELDS, next(csv.reader(stream))))
        self.assertEqual(row['source_sha256'], original['source_sha256'])
        self.assertEqual(row['eligible'], original['eligible'])
        self.assertEqual(row['grain'], 'state'); self.assertEqual(row['section'], '')
        self.assertEqual(row['turn'], ''); self.assertEqual(row['null_votes'], original['null'])


if __name__ == '__main__':
    unittest.main()
