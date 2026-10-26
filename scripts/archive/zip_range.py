"""Seekable, version-checked HTTP byte ranges for selecting members of large official ZIPs."""
import collections
import dataclasses
import io
import http.client
import urllib.parse
import urllib.request
import urllib.error


@dataclasses.dataclass(frozen=True)
class ZipMetadataSnapshot:
    url: str
    resolved_url: str
    version: tuple
    ranges: tuple


class RemoteZipFile(io.RawIOBase):
    def __init__(self, url, block_size=4096, version=None, connection=None, capture=False, snapshot=None):
        self.connection = None
        self.source_url = url
        if snapshot is not None:
            if snapshot.url != url or version is not None:
                raise ValueError('ZIP metadata snapshot must identify this source and its version')
            version = snapshot.version
            url = snapshot.resolved_url
        self.prefetched = list(snapshot.ranges) if snapshot is not None else []
        self.capture = capture
        self.url = url
        if version is None:
            for attempt in range(3):
                try:
                    with urllib.request.urlopen(urllib.request.Request(url, method='HEAD'), timeout=40) as response:
                        self.size = int(response.headers['Content-Length'])
                        self.etag = response.headers['ETag']
                        url = response.geturl()
                        self.url = url
                    break
                except (TimeoutError, ConnectionError, urllib.error.URLError) as error:
                    reason = error.reason if isinstance(error, urllib.error.URLError) else error
                    if not isinstance(reason, (TimeoutError, ConnectionError)) or attempt == 2:
                        raise
        else:
            self.size, self.etag = version
        address = urllib.parse.urlsplit(url)
        self.path = urllib.parse.urlunsplit(("", "", address.path, address.query, ""))
        self.connection = connection or http.client.HTTPSConnection(address.hostname, timeout=60)
        super().__init__()
        self.position = 0
        self.block_size = block_size
        self.blocks = collections.OrderedDict()
        self.transferred = 0
        self.requests = 0

    def snapshot(self):
        return ZipMetadataSnapshot(self.source_url, self.url, (self.size, self.etag), tuple(self.prefetched))

    def seekable(self):
        return True

    def readable(self):
        return True

    def tell(self):
        return self.position

    def seek(self, offset, whence=0):
        position = offset if whence == 0 else self.position + offset if whence == 1 else self.size + offset
        if position < 0:
            raise ValueError('Negative ZIP seek')
        self.position = position
        return position

    def fetch(self, start, end):
        for offset, cached in self.prefetched:
            if offset <= start and end < offset + len(cached):
                return cached[start - offset:end - offset + 1]
        for attempt in range(3):
            self.requests += 1
            try:
                self.connection.request('GET', self.path, headers={'Range': f'bytes={start}-{end}', 'If-Match': self.etag})
                with self.connection.getresponse() as response:
                    expected = f'bytes {start}-{end}/{self.size}'
                    if response.status != 206 or response.headers.get('Content-Range') != expected or response.headers.get('ETag') != self.etag:
                        raise ValueError('Source does not supply stable, exact HTTP byte ranges')
                    data = response.read()
                break
            except (TimeoutError, ConnectionError, http.client.RemoteDisconnected, http.client.IncompleteRead):
                self.connection.close()
                if attempt == 2:
                    raise
        if len(data) != end - start + 1:
            raise ValueError('Truncated HTTP byte range')
        self.transferred += len(data)
        if self.capture:
            self.prefetched.append((start, data))
        return data

    def block(self, index):
        if index in self.blocks:
            self.blocks.move_to_end(index)
            return self.blocks[index]
        start = index * self.block_size
        end = min(start + self.block_size, self.size) - 1
        data = self.fetch(start, end)
        self.blocks[index] = data
        if len(self.blocks) > 16:
            self.blocks.popitem(last=False)
        return data

    def read(self, size=-1):
        size = self.size - self.position if size < 0 else min(size, self.size - self.position)
        if size >= self.block_size:
            data = self.fetch(self.position, self.position + size - 1)
            self.position += len(data)
            return data
        chunks = []
        while size > 0:
            index, offset = divmod(self.position, self.block_size)
            block = self.block(index)
            take = min(len(block) - offset, size)
            chunks.append(block[offset:offset + take])
            self.position += take
            size -= take
        return b''.join(chunks)

    def close(self):
        if self.connection is not None:
            self.connection.close()
        super().close()
