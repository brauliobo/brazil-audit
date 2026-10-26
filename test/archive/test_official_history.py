import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / 'scripts/archive'))
from official_history import adapt
from normalize_history import normalize, append_row


class OfficialHistoryTest(unittest.TestCase):
    def setUp(self):
        self.config = dict(year=2026, turn=2, date='2026-10-25', official=dict(events={'1': 6258, '3': 6260}))
        self.source = dict(ele='6258', t='2', carg=[dict(cd='1', nmn='Presidente')],
                           e=dict(te='100', esi='98', esni='2', c='80', a='18'),
                           v=dict(vv='70', vb='3', vn='7', tvn='7', vnt='0'), s=dict(ts='10'))

    def test_national_reference_and_registered_denominator_stay_distinct(self):
        row = adapt(self.source, dict(state='br'), self.config, 'https://resultados.tse.jus.br/source.json', 'sha', normalize)
        self.assertEqual(row['scope'], 'national')
        self.assertEqual(row['eligible'], 100)
        self.assertEqual(row['installed'], 98)
        self.assertEqual(row['valid'], 70)
        self.assertEqual(row['null'], 7)
        self.assertIsNone(row['annulled_separate'])
        self.assertEqual(row['source_sha256'], 'sha')
        self.assertEqual(row['election_id'], '2026:6258:2:2026-10-25')

    def test_wrong_election_office_or_broken_participation_is_rejected(self):
        self.source['carg'][0]['cd'] = '3'
        with self.assertRaises(ValueError):
            adapt(self.source, dict(state='ac'), self.config, 'https://resultados.tse.jus.br/source.json', 'sha', normalize)
        self.source['carg'][0]['cd'] = '1'
        self.source['e']['a'] = '19'
        with self.assertRaises(ValueError):
            adapt(self.source, dict(state='ac'), self.config, 'https://resultados.tse.jus.br/source.json', 'sha', normalize)

    def test_overlapping_csv_and_json_grain_is_reconciled_instead_of_added_twice(self):
        row = adapt(self.source, dict(state='ac'), self.config, 'https://resultados.tse.jus.br/source.json', 'sha', normalize)
        elections, diagnostics = {}, []
        append_row(elections, row, 2026, diagnostics)
        append_row(elections, row.copy(), 2026, diagnostics)
        self.assertEqual(len(elections[row['election_id']]['rows']), 1)
        self.assertEqual(diagnostics, [])
        append_row(elections, {**row, 'null': 8}, 2026, diagnostics)
        self.assertEqual(len(elections[row['election_id']]['rows']), 1)
        self.assertEqual(diagnostics[0]['unavailableMetrics'], ['null'])
        self.assertIsNone(next(iter(elections[row['election_id']]['rows'].values()))['null'])

    def test_ballot_denominator_is_native_and_not_inferred_from_voters(self):
        source = dict(id='source', url='https://cdn.tse.jus.br/source.zip')
        row = normalize(dict(ANO_ELEICAO='2018', CD_CARGO='5', DS_CARGO='Senador', QT_APTOS='1000', QT_COMPARECIMENTO='800', QT_VOTOS='1600'), source)
        self.assertEqual(row['ballots'], 1600)
        self.assertEqual(row['present'], 800)
        row = normalize(dict(ANO_ELEICAO='1989', QTD_COMPARECIMENTO='800'), source)
        self.assertIsNone(row['ballots'])

    def test_converted_zero_total_is_unavailable_when_reported_votes_are_positive(self):
        row = normalize(dict(ANO_ELEICAO='1994', QT_VOTOS='0', QT_VOTOS_BRANCOS='923', QT_VOTOS_NULOS='884'),
                        dict(id='source', url='https://cdn.tse.jus.br/source.zip'))
        self.assertIsNone(row['ballots'])
        self.assertEqual(row['blank'], 923)
        self.assertEqual(row['null'], 884)
        self.assertEqual(row['_invalid_ballots'], 0)

    def test_annulled_categories_are_retained_without_assuming_they_are_null(self):
        row = normalize(dict(ANO_ELEICAO='2018', QT_TOTAL_VOTOS_ANULADOS='2', QT_TOTAL_VOTOS_ANUL_SUBJUD='3', QT_VOTOS_ANULADOS_APU_SEP='746'),
                        dict(id='source', url='https://cdn.tse.jus.br/source.zip'))
        self.assertEqual([row[k] for k in ['annulled', 'annulled_subjudice', 'annulled_separate']], [2, 3, 746])
        self.assertIsNone(row['null'])
