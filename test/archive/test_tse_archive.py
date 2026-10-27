import importlib.util
import pathlib
import hashlib
import tempfile
import unittest
import zipfile

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

    def test_declared_zip_cannot_be_published_as_an_opaque_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            path = root / 'broken.zip'
            path.write_bytes(b'CSV;NOT;ZIP\n')
            with self.assertRaises(zipfile.BadZipFile):
                self.archive.public_copy(path, root / 'public.zip')
            with self.assertRaises(zipfile.BadZipFile):
                self.archive.validate_archive(path, {'format': 'ZIP', 'url': 'https://example.org/download'})
            self.assertFalse((root / 'public.zip').exists())

    def test_cached_truncated_zip_is_not_trusted_by_its_hash(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            url = 'https://example.org/source.zip'
            cached = root / 'downloads' / hashlib.sha256(url.encode()).hexdigest()
            cached.mkdir(parents=True)
            path = cached / 'source.zip'
            with zipfile.ZipFile(path, 'w') as archive:
                archive.writestr('source.csv', 'a;b\n1;2\n')
            path.write_bytes(path.read_bytes()[:-22])
            self.archive.write_json(cached / 'state.json', {'bytes': path.stat().st_size, 'sha256': self.archive.sha256(path)})
            with self.assertRaises(zipfile.BadZipFile):
                self.archive.download(root, {'url': url})

    def test_zip_member_crc_is_checked_before_publication(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            path = root / 'source.zip'
            with zipfile.ZipFile(path, 'w', compression=zipfile.ZIP_STORED) as archive:
                archive.writestr('source.csv', 'unique payload')
            path.write_bytes(path.read_bytes().replace(b'unique payload', b'broken payload'))
            with self.assertRaisesRegex(ValueError, 'ZIP CRC mismatch'):
                self.archive.public_copy(path, root / 'public.zip')


if __name__ == '__main__':
    unittest.main()
