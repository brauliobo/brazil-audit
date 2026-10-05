require 'zip'
require 'digest'

# The entries of one state, written as independent zips (2022-1t-rdv-logs-<uf>-NN.zip), each below LIMIT bytes. A part is
# written as name.part and gets its name, and its row in the manifest, only when it is complete.
class RdvlogPack
  LIMIT   = 1800 << 20 # the releases take assets below 2 GiB
  ENTRIES = 50_000

  attr_reader :added

  def initialize round, uf, url, manifest
    @round, @uf, @url, @manifest = round, uf, url, manifest
    @parts = manifest.rows.count{ |name, _| name.start_with? prefix }
    @added = 0
  end

  def prefix = "#{YEAR}-#{@round}-rdv-logs-#{@uf.downcase}-"

  # the entry names already in the finished parts
  def done
    @manifest.rows.keys.select{ |name| name.start_with? prefix }.flat_map{ |name| Zip::File.open("#{RDVLOG_DIR}/#{name}"){ |zip| zip.entries.map(&:name) } }.to_set
  end

  def add name, data
    start if @zip.nil?
    @zip.put_next_entry name, nil, nil, name.end_with?('.rdv') ? Zip::Entry::DEFLATED : Zip::Entry::STORED
    @zip.write data
    @bytes += data.bytesize
    @count += 1
    @added += 1
    finish if @bytes >= LIMIT || @count >= ENTRIES
  end

  def finish
    return unless @zip

    @zip.close
    @zip = nil
    File.rename "#{@path}.part", @path
    @manifest.add [File.basename(@path), File.size(@path), Digest::SHA256.file(@path).hexdigest, @url, @count.to_s]
  end

  private

  def start
    @parts += 1
    @path   = "#{RDVLOG_DIR}/#{prefix}#{'%02d' % @parts}.zip"
    @zip    = Zip::OutputStream.open "#{@path}.part"
    @bytes  = @count = 0
  end
end
