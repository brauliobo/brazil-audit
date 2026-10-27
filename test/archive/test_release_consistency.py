import pathlib
import sys
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / 'scripts/archive'))
from sync_release_tags import owned_identity, verify_assets, publication_complete
from tse_archive import sha256, write_json


class PublicationConsistencyTest(unittest.TestCase):
    def test_original_and_unowned_tags_can_never_be_modified(self):
        for identifier in ['2018', '2022', '2026', '2026-2']:
            with self.assertRaises(ValueError):
                owned_identity(dict(dataset=dict(id=identifier, tag=f'data-{identifier}', branch=f'archive/{identifier}')), {identifier})
        with self.assertRaises(ValueError):
            owned_identity(dict(dataset=dict(id='resultados-1933', tag='data-resultados-1933', branch='main')), {'resultados-1933'})
        self.assertEqual(owned_identity(dict(dataset=dict(id='resultados-1933', tag='data-resultados-1933', branch='archive/resultados-1933')), {'resultados-1933'})[1], 'data-resultados-1933')

    def test_initial_schema_v1_uses_explicit_resource_states_without_rewriting_assets(self):
        self.assertTrue(publication_complete(dict(schemaVersion=1, resources=[dict(status='prepared')])))
        self.assertFalse(publication_complete(dict(schemaVersion=1, resources=[dict(status='downloading')])))
        self.assertFalse(publication_complete(dict(schemaVersion=1, status='partial', resources=[dict(status='prepared')])))

    def test_publication_requires_exact_remote_asset_names_bytes_and_digests(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = pathlib.Path(temporary)
            (directory / 'data.zip').write_bytes(b'data')
            manifest = dict(resources=[dict(assets=[dict(name='data.zip', bytes=4)])])
            write_json(directory / 'ARCHIVE.json', manifest)
            (directory / 'README.md').write_text('Official source\n')
            (directory / 'SHA256SUMS').write_text(f'{sha256(directory / "data.zip")}  data.zip\n')
            assets = [dict(name=p.name, size=p.stat().st_size, digest=f'sha256:{sha256(p)}') for p in directory.iterdir()]
            verification = dict(assets=len(assets), bytes=sum(a['size'] for a in assets))
            self.assertEqual(len(verify_assets(directory, manifest, verification, assets)), 64)
            changed = [{**a, 'size': a['size'] + 1} if a['name'] == 'data.zip' else a for a in assets]
            with self.assertRaises(ValueError):
                verify_assets(directory, manifest, verification, changed)
            with self.assertRaises(ValueError):
                verify_assets(directory, manifest, verification, assets[:-1])
