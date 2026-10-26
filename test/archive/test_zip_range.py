import io
import pathlib
import sys
import unittest
from unittest.mock import patch
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts/archive'))
from zip_range import RemoteZipFile


class Response(io.BytesIO):
    def __init__(self, body, status, headers):
        super().__init__(body)
        self.status = status
        self.headers = headers

    def geturl(self):
        return 'https://cdn.tse.jus.br/a.zip'


class Connection:
    def __init__(self, responder):
        self.responder = responder

    def request(self, method, path, headers):
        self.req = __import__('urllib.request', fromlist=['Request']).Request('https://cdn.tse.jus.br' + path, headers=headers)

    def getresponse(self):
        return self.responder(self.req, 60)

    def close(self):
        pass


class RemoteArchiveTest(unittest.TestCase):
    def test_zip_members_are_selected_and_crc_verified_using_exact_ranges(self):
        content = io.BytesIO()
        with zipfile.ZipFile(content, 'w') as z:
            z.writestr('log.jez', b'log data' * 10000)
            z.writestr('urn-rdv.dat', b'actual anonymous RDV')
        body = content.getvalue()
        def request(req, timeout):
            if req.get_method() == 'HEAD':
                return Response(b'', 200, {'Content-Length': str(len(body)), 'ETag': '"version"'})
            interval = req.get_header('Range').removeprefix('bytes=')
            start, end = map(int, interval.split('-'))
            self.assertEqual(req.get_header('If-match'), '"version"')
            return Response(body[start:end + 1], 206, {'Content-Range': f'bytes {start}-{end}/{len(body)}', 'ETag': '"version"'})
        with patch('urllib.request.urlopen', request), RemoteZipFile('https://cdn.tse.jus.br/a.zip', block_size=128, connection=Connection(request)) as file, zipfile.ZipFile(file) as z:
            self.assertEqual(z.read('urn-rdv.dat'), b'actual anonymous RDV')
            self.assertLess(file.transferred, len(body) // 10)

    def test_metadata_snapshot_shares_verified_bytes_without_another_request(self):
        def request(req, timeout):
            if req.get_method() == 'HEAD':
                return Response(b'', 200, {'Content-Length': '100', 'ETag': '"version"'})
            return Response(b'x' * 100, 206, {'Content-Range': 'bytes 0-99/100', 'ETag': '"version"'})
        with patch('urllib.request.urlopen', request), RemoteZipFile('https://cdn.tse.jus.br/a.zip', connection=Connection(request), capture=True) as first:
            self.assertEqual(first.read(1), b'x')
            snapshot = first.snapshot()
        with RemoteZipFile('https://cdn.tse.jus.br/a.zip', connection=Connection(request), snapshot=snapshot) as second:
            self.assertEqual(second.read(1), b'x')
            self.assertEqual(second.requests, 0)
        with self.assertRaisesRegex(ValueError, 'snapshot'):
            RemoteZipFile('https://cdn.tse.jus.br/another.zip', snapshot=snapshot)

    def test_transport_timeout_reconnects_the_same_versioned_range(self):
        attempts = []
        def request(req, timeout):
            if req.get_method() == 'HEAD':
                return Response(b'', 200, {'Content-Length': '100', 'ETag': '"version"'})
            attempts.append((req.get_header('Range'), req.get_header('If-match')))
            if len(attempts) == 1:
                raise TimeoutError('Source TLS read timed out')
            return Response(b'x' * 100, 206, {'Content-Range': 'bytes 0-99/100', 'ETag': '"version"'})
        with patch('urllib.request.urlopen', request), RemoteZipFile('https://cdn.tse.jus.br/a.zip', connection=Connection(request)) as file:
            self.assertEqual(file.read(1), b'x')
            self.assertEqual(file.requests, 2)
        self.assertEqual(attempts[0], attempts[1])

    def test_a_server_ignoring_ranges_is_an_error_not_a_full_download_fallback(self):
        def request(req, timeout):
            if req.get_method() == 'HEAD':
                return Response(b'', 200, {'Content-Length': '100', 'ETag': '"version"'})
            return Response(b'x' * 100, 200, {'ETag': '"version"'})
        with patch('urllib.request.urlopen', request), RemoteZipFile('https://cdn.tse.jus.br/a.zip', connection=Connection(request)) as file:
            with self.assertRaisesRegex(ValueError, 'stable, exact'):
                file.read(1)


if __name__ == '__main__':
    unittest.main()
