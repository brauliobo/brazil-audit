import importlib.util
import pathlib
import unittest

MODULE = pathlib.Path(__file__).resolve().parents[2] / 'scripts' / 'archive' / 'tse_archive.py'


class CatalogTest(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location('tse_archive', MODULE)
        self.archive = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.archive)

    def test_catalog_preserves_every_resource_and_deduplicates_urls(self):
        source = [{'name': 'resultados-1933', 'title': 'Resultados - 1933', 'license_id': 'cc-by',
                   'groups': [{'name': 'resultados'}], 'resources': [
                       {'id': 'a', 'name': 'UF', 'url': 'https://cdn.tse.jus.br/a.zip', 'format': 'CSV'},
                       {'id': 'b', 'name': 'duplicate', 'url': 'https://cdn.tse.jus.br/a.zip', 'format': 'ZIP'},
                       {'id': 'c', 'name': 'unavailable', 'url': '', 'format': ''}]}]
        catalog = self.archive.catalogue(source)
        self.assertEqual(catalog['earliestYear'], 1933)
        self.assertEqual(catalog['resourceCount'], 3)
        self.assertEqual(catalog['uniqueUrlCount'], 1)
        dataset = catalog['datasets'][0]
        self.assertEqual(dataset['branch'], 'archive/resultados-1933')
        self.assertEqual(dataset['tag'], 'data-resultados-1933')
        self.assertFalse(dataset['normalized'])
        self.assertEqual(dataset['resources'][2]['status'], 'unsupported-url')

    def test_personal_identifiers_are_removed_at_the_header_abstraction(self):
        fields = ['ANO_ELEICAO', 'NM_CANDIDATO', 'NR_CPF_CANDIDATO', 'DS_EMAIL', 'VR_RECEITA', 'NR_CONTA_BANCARIA']
        self.assertEqual(self.archive.public_columns(fields), [0, 1, 4])
        self.assertEqual(self.archive.public_columns(['SG_UF', 'QT_APTOS']), [0, 1])


if __name__ == '__main__':
    unittest.main()
