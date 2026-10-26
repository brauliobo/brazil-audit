import importlib.util
import pathlib
import sys
import tempfile
import unittest
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts/archive'))
import normalize_history as history


class HistoricalSummariesTest(unittest.TestCase):
    def test_historical_unavailable_values_and_non_round_elections_stay_unknown(self):
        row = history.normalize({'ANO_ELEICAO': '1933', 'NUM_TURNO': '-3', 'DESC_ELEICAO': 'ASSEMBLEIA NACIONAL CONSTITUINTE',
                                 'SIGLA_UF': 'AC', 'COD_CARGO': '6', 'DESC_CARGO': 'DEPUTADO', 'QTD_APTOS': '1968',
                                 'QTD_COMPARECIMENTO': '1869', 'QTD_ABSTENCOES': '99', 'QTD_VOTOS_BRANCOS': '-1'},
                                {'id': 'source', 'url': 'https://cdn.tse.jus.br/source.zip'})
        self.assertIsNone(row['turn'])
        self.assertIsNone(row['blank'])
        self.assertEqual(row['present'] + row['absent'], row['eligible'])
        self.assertEqual(row['office_key'], 'historical:6:DEPUTADO')
        self.assertNotEqual(row['office_key'], history.office_key('6', 'Deputado Federal'))

    def test_converted_historical_valid_votes_require_consistent_components(self):
        raw = {'ANO_ELEICAO': '2000', 'NR_TURNO': '1', 'CD_ELEICAO': '2000001', 'SG_UF': 'TO',
               'CD_MUNICIPIO': '73083', 'NR_ZONA': '-3', 'CD_CARGO': '13', 'DS_CARGO': 'Vereador',
               'QT_TOTAL_VOTOS_VALIDOS': '1643', 'QT_VOTOS_NOMINAIS_VALIDOS': '1643', 'QT_TOTAL_VOTOS_LEG_VALIDOS': '247'}
        row = history.normalize(raw, {'id': 'a', 'url': 'https://cdn.tse.jus.br/a.zip'})
        self.assertEqual(row['scope'], 'municipality')
        self.assertEqual(row['zone'], '')
        self.assertIsNone(row['valid'])
        raw['QT_TOTAL_VOTOS_VALIDOS'] = '1890'
        self.assertEqual(history.normalize(raw, {'id': 'a', 'url': 'https://cdn.tse.jus.br/a.zip'})['valid'], 1890)

    def test_conflicting_senate_metrics_do_not_discard_consistent_turnout(self):
        first = dict.fromkeys(history.METRICS)
        first.update(eligible=926431, present=658846, absent=267585, blank=119063, null=51295)
        second = {**first, 'blank': 210920, 'null': 37238}
        merged, conflicts = history.reconcile(first, second)
        self.assertEqual(conflicts, ['blank', 'null'])
        self.assertEqual(merged['present'], 658846)
        self.assertEqual(merged['absent'], 267585)
        self.assertIsNone(merged['blank'])
        self.assertIsNone(merged['null'])

    def test_null_ballot_fields_retain_their_distinct_official_meanings(self):
        row = history.normalize({'ANO_ELEICAO': '2006', 'QT_VOTOS_NULOS': '2740', 'QT_TOTAL_VOTOS_NULOS': '2737',
                                 'QT_VOTOS_NULOS_TECNICOS': '0'}, {'id': 'source', 'url': 'https://cdn.tse.jus.br/source.zip'})
        self.assertEqual(row['null'], 2740)
        self.assertEqual(row['null_total'], 2737)
        self.assertEqual(row['null_technical'], 0)

    def test_distinct_supplementary_dates_do_not_collapse_under_a_reused_source_code(self):
        raw = {'ANO_ELEICAO': '2008', 'CD_ELEICAO': '32', 'NR_TURNO': '1', 'DT_ELEICAO': '01/03/2009'}
        source = {'id': 'source', 'url': 'https://cdn.tse.jus.br/source.zip'}
        first = history.normalize(raw, source)
        second = history.normalize({**raw, 'DT_ELEICAO': '01/04/2012'}, source)
        self.assertNotEqual(first['election_id'], second['election_id'])
        self.assertEqual(first['source_election_id'], second['source_election_id'])
        self.assertEqual(first['year'], 2008)
        self.assertEqual(first['date'], '01/03/2009')

    def test_installed_electorate_requires_the_source_participation_balance(self):
        raw = {'ANO_ELEICAO': '2022', 'QT_APTOS': '11077', 'QT_COMPARECIMENTO': '2336', 'QT_ABSTENCOES': '172',
               'QT_ELEITORES_SECOES_NAO_INSTALADAS': '0'}
        source = {'id': 'source', 'url': 'https://cdn.tse.jus.br/source.zip'}
        row = history.normalize(raw, source)
        self.assertEqual(row['eligible'], 11077)
        self.assertIsNone(row['installed'])
        self.assertIsNotNone(history.source_issue(row))
        raw['QT_ELEITORES_SECOES_NAO_INSTALADAS'] = '8569'
        row = history.normalize(raw, source)
        self.assertEqual(row['installed'], 2508)
        self.assertEqual(row['eligible'], 11077)
        self.assertIsNone(history.source_issue(row))

    def test_headerless_official_legacy_archive_keeps_its_first_record(self):
        with tempfile.TemporaryDirectory() as root:
            path = pathlib.Path(root) / 'source.zip'
            values = ['5/11/2012', '17:05:00', '1989', '1', 'ELEIÇÕES 1989', 'AC', 'BR', '1', 'PRESIDENTE',
                      '182797', '140309', '42488', '128010', '2673', '9626', '-3', '-3', '612', '0', '1', '8', '-1']
            body = ';'.join(f'"{v}"' for v in values) + '\n'
            with zipfile.ZipFile(path, 'w') as z:
                z.writestr('DETALHE.txt', body.encode('latin1'))
            rows = list(history.records(path, {'id': 'source', 'url': 'https://cdn.tse.jus.br/detalhe_votacao_uf/a.zip'}))
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]['present'], 140309)
            self.assertEqual(rows[0]['office_key'], 'president')


if __name__ == '__main__':
    unittest.main()
