"""Seekable, version-checked HTTP byte ranges for selecting members of large official ZIPs."""
import collections
import io
import http.client
import urllib.parse
import urllib.request


class RemoteZipFile(io.RawIOBase):
    def __init__(self, url, block_size=4096, version=None, connection=None):
        self.url = url
        if version is None:
            with urllib.request.urlopen(urllib.request.Request(url, method='HEAD'), timeout=40) as response:
                self.size = int(response.headers['Content-Length'])
                self.etag = response.headers['ETag']
                url = response.geturl()
                self.url = url
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
        self.connection.close()
        super().close()
