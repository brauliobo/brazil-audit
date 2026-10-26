import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / 'scripts/archive'))
from archive_rdv import identity


class OfficialRdvIdentityTest(unittest.TestCase):
    def test_modern_source_and_legacy_published_member_share_exact_election_identity(self):
        self.assertEqual(identity('o00407ac0100700090001-rdv.dat'),
                         identity('files/ac-01007-0009-0001-hash-o00407-0100700090001.rdv'))

    def test_older_source_requires_state_context_and_preserves_turn_election_code(self):
        self.assertIsNone(identity('o00406-0100700090001.rdv'))
        self.assertEqual(identity('o00406-0100700090001.rdv', 'AC'), 'o00406:ac:0100700090001')
        self.assertNotEqual(identity('o00406-0100700090001.rdv', 'AC'), identity('o00407-0100700090001.rdv', 'AC'))


class DerivedCollectionTest(unittest.TestCase):
    def test_new_rdv_collection_never_inherits_a_csv_publication(self):
        from archive_rdv import derived_collection
        source = dict(id='resultados-2020', title='Resultados', groups=['resultados'], years=[2020], license='',
                      source='https://dadosabertos.tse.jus.br/dataset/resultados-2020', status='published',
                      publicationVerifiedAt='old', releaseUrl='https://github.com/example/csv', normalized=True)
        derived = derived_collection(source, [])
        self.assertEqual(derived['status'], 'downloading')
        self.assertNotIn('publicationVerifiedAt', derived)
        self.assertFalse(derived['normalized'])
        self.assertTrue(derived['releaseUrl'].endswith('/data-rdv-resultados-2020'))

    def test_cached_subset_is_rejected_when_official_member_inventory_has_more_rdv(self):
        import hashlib
        import io
        import tempfile
        import zipfile
        from unittest.mock import patch
        from archive_rdv import extract_bundle
        from tse_archive import write_json, sha256
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w') as archive:
            archive.writestr('unfamiliar-section-identity.rdv', b'older format')
            archive.writestr('o00452ac0100700090002-rdv.dat', b'newer format')
        body = buffer.getvalue()
        class Source(io.BytesIO):
            def __init__(self, *args, **kwargs):
                super().__init__(body)
                self.size, self.etag, self.transferred, self.requests = len(body), 'version', 0, 0
            def snapshot(self):
                return None
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            resource = dict(id='resource', url='https://cdn.tse.jus.br/source_AC.zip')
            directory = root / 'rdv' / hashlib.sha256(resource['url'].encode()).hexdigest()
            directory.mkdir(parents=True)
            old = directory / 'old.zip'
            old.write_bytes(b'old subset')
            with zipfile.ZipFile(io.BytesIO(body)) as archive:
                info = archive.getinfo('o00452ac0100700090002-rdv.dat')
            write_json(directory / 'VERIFIED.json', dict(etag='version', extracted=[dict(name=info.filename, bytes=info.file_size, crc32=info.CRC)], reused=[],
                       assets=[dict(name=old.name, sha256=sha256(old))]))
            with patch('archive_rdv.RemoteZipFile', Source):
                result, paths = extract_bundle(root, resource, {})
            self.assertEqual(result['membersAvailable'], 2)
            self.assertEqual(result['membersExtracted'], 2)
            self.assertEqual(result['selectionVersion'], 2)
            self.assertEqual(len(paths), 2)

    def test_more_than_eight_streams_share_the_global_connection_budget(self):
        import io
        import tempfile
        import threading
        import time
        import zipfile
        from unittest.mock import patch
        import archive_rdv
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w') as archive:
            for i in range(12):
                archive.writestr(f'section-{i}.rdv', b'votes')
        body = buffer.getvalue()
        active = peak = 0
        lock = threading.Lock()
        class Source(io.BytesIO):
            def __init__(self, *args, **kwargs):
                nonlocal active, peak
                super().__init__(body)
                self.size, self.etag, self.transferred, self.requests = len(body), 'version', 0, 0
                with lock:
                    active += 1
                    peak = max(peak, active)
            def read(self, n=-1):
                time.sleep(.001)
                return super().read(n)
            def snapshot(self):
                return None
            def close(self):
                nonlocal active
                if not self.closed:
                    with lock:
                        active -= 1
                super().close()
        # Simulate thirty-one connections occupied by the other bundle workers.
        for _ in range(31):
            archive_rdv.NETWORK_SLOTS.acquire()
        try:
            with tempfile.TemporaryDirectory() as temporary, patch('archive_rdv.RemoteZipFile', Source):
                result, paths = archive_rdv.extract_bundle(pathlib.Path(temporary), dict(id='resource', url='https://cdn.tse.jus.br/source.zip'), {})
            self.assertEqual(len(paths), 12)
            self.assertEqual(result['membersExtracted'], 12)
            self.assertEqual(peak, 1)
            self.assertEqual(active, 0)
        finally:
            for _ in range(31):
                archive_rdv.NETWORK_SLOTS.release()
