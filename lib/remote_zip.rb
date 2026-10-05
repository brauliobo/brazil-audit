require 'net/http'
require 'zlib'

# A zip on a server, read with HTTP Range requests: its central directory, then only the entries asked for, many ranges per
# request. Every entry is inflated and checked against the CRC and the size of the central directory.
class RemoteZip
  Entry = Struct.new :name, :method, :crc, :csize, :size, :offset, :limit # limit: where the next entry (or the directory) starts

  class RangeNotHonoured < StandardError; end

  AGENT      = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
  MAX_RANGES = 100
  MAX_BYTES  = 32 << 20
  ATTEMPTS   = 3

  attr_reader :url, :transferred

  def initialize url
    @url         = url
    @uri         = URI url
    @transferred = 0
  end

  # [Entry], in the order of the archive
  def entries
    @entries ||= begin
      tail = fetch([-4096]).first.last
      cd_size, cd_offset = directory tail
      parse(fetch([[cd_offset, cd_offset + cd_size - 1]]).first.last, cd_offset)
    end
  end

  # { entry name => data } of the entries picked, in batches of ranges; yields each batch as it is read
  def read picked
    return if picked.empty?

    runs = picked.sort_by(&:offset).chunk_while{ |a, b| a.limit == b.offset }.map{ |run| [run.first.offset, run.last.limit - 1, run] }
    batches(runs).each do |batch|
      fetch(batch.map{ |from, to, _| [from, to] }).each_with_index do |(from, data), i|
        yield batch[i].last.to_h{ |entry| [entry.name, extract(entry, data.byteslice(entry.offset - from, entry.limit - entry.offset))] }
      end
    end
  end

  # reads the package up to limit bytes, which has the CDN cache it (it answers without Range until then)
  def warm limit
    total = 0
    http.request_get(@uri.request_uri, 'User-Agent' => AGENT) do |res|
      res.read_body do |chunk|
        total += chunk.bytesize
        (@http = nil; raise "#{url}: not cached and over #{limit} bytes") if total > limit
      end
    end
    @transferred += total
  end

  private

  def batches runs
    runs.each_with_object([[]]) do |run, out|
      out << [] if out.last.size >= MAX_RANGES || out.last.sum{ |from, to, _| to - from + 1 } >= MAX_BYTES
      out.last << run
    end
  end

  # [[from, data]] for the ranges, [-n] being the last n bytes
  def fetch ranges
    spec = ranges.map{ |r| r.is_a?(Array) ? r.join('-') : r.to_s }.join ','
    res  = request spec
    @transferred += res.body.bytesize
    raise RangeNotHonoured, "#{url}: #{res.code} for #{ranges.size} ranges" unless res.code == '206'

    multipart?(res) ? multipart(res) : [[res['content-range'][/bytes (\d+)-/, 1].to_i, res.body]]
  end

  def request spec
    (1..ATTEMPTS).each do |attempt|
      return http.get(@uri.request_uri, 'Range' => "bytes=#{spec}", 'User-Agent' => AGENT)
    rescue IOError, SystemCallError, Net::ProtocolError, Timeout::Error, OpenSSL::SSL::SSLError => e
      @http = nil
      raise if attempt == ATTEMPTS

      sleep attempt * 5
    end
  end

  def http
    @http ||= Net::HTTP.start(@uri.host, @uri.port, use_ssl: true, read_timeout: 120)
  end

  def multipart?(res) = res['content-type'].to_s.start_with? 'multipart/byteranges'

  def multipart res
    boundary = "--#{res['content-type'][/boundary=([^;\s]+)/, 1]}"
    body     = res.body.b
    pos      = 0
    parts    = []
    while (start = body.index(boundary, pos)) && !body[start + boundary.size, 2].start_with?('--')
      head     = body.index("\r\n\r\n", start) + 4
      from, to = body.byteslice(start, head - start).match(/Content-Range: bytes (\d+)-(\d+)/i).captures.map(&:to_i)
      parts << [from, body.byteslice(head, to - from + 1)]
      pos = head + (to - from + 1)
    end
    parts
  end

  # the central directory is at the end: the end of central directory record, then its zip64 locator when there is one
  def directory tail
    eocd = tail.rindex "PK\x05\x06".b
    size, offset = tail.byteslice(eocd + 12, 8).unpack 'VV'
    return [size, offset] unless size == 0xFFFFFFFF || offset == 0xFFFFFFFF

    locator = tail.rindex "PK\x06\x07".b
    record  = tail.byteslice(locator + 8, 8).unpack1 'Q<'
    record_data = fetch([[record, record + 55]]).first.last
    record_data.byteslice(40, 16).unpack 'Q<Q<'
  end

  def parse data, base
    entries = []
    pos     = 0
    while data.byteslice(pos, 4) == "PK\x01\x02".b
      method, _, _, crc, csize, size, nlen, elen, clen = data.byteslice(pos + 10, 24).unpack 'vvvVVVvvv'
      offset = data.byteslice(pos + 42, 4).unpack1 'V'
      name   = data.byteslice(pos + 46, nlen)
      extra  = data.byteslice(pos + 46 + nlen, elen)
      size, csize, offset = zip64 extra, size, csize, offset
      entries << Entry.new(name, method, crc, csize, size, offset)
      pos += 46 + nlen + elen + clen
    end
    entries.sort_by(&:offset).each_cons(2){ |a, b| a.limit = b.offset }
    entries.max_by(&:offset).limit = base
    entries
  end

  # the zip64 extra field holds, in this order, the values that are 0xFFFFFFFF in the header
  def zip64 extra, size, csize, offset
    pos = 0
    while pos < extra.bytesize
      id, len = extra.byteslice(pos, 4).unpack 'vv'
      if id == 1
        values = extra.byteslice(pos + 4, len).unpack 'Q<*'
        size   = values.shift if size == 0xFFFFFFFF
        csize  = values.shift if csize == 0xFFFFFFFF
        offset = values.shift if offset == 0xFFFFFFFF
      end
      pos += 4 + len
    end
    [size, csize, offset]
  end

  def extract entry, span
    raise "#{url}: #{entry.name}: bad local header" unless span.byteslice(0, 4) == "PK\x03\x04".b

    nlen, elen = span.byteslice(26, 4).unpack 'vv'
    raise "#{url}: #{entry.name}: local name differs" unless span.byteslice(30, nlen) == entry.name

    packed = span.byteslice 30 + nlen + elen, entry.csize
    data   = entry.method == 8 ? Zlib::Inflate.new(-Zlib::MAX_WBITS).inflate(packed) : packed
    raise "#{url}: #{entry.name}: #{data.bytesize} bytes, expected #{entry.size}" unless data.bytesize == entry.size
    raise "#{url}: #{entry.name}: CRC differs" unless Zlib.crc32(data) == entry.crc

    data
  end
end
