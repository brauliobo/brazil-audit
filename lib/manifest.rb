# A MANIFEST.tsv: the release assets of a directory with the checksums to verify them. A row is added when its download
# finishes, so a resume only downloads what is not listed.
class Manifest
  LOCK = Mutex.new

  attr_reader :rows

  def initialize path, header
    @path, @header = path, header
    @rows = File.exist?(path) ? File.readlines(path, chomp: true).drop(1).map{ |line| line.split "\t" }.to_h{ |r| [r.first, r] } : {}
  end

  def add row
    LOCK.synchronize do
      @rows[row.first] = row
      File.write @path, ([@header] + @rows.values.sort).map{ |r| r.join("\t") + "\n" }.join
    end
    row
  end

  # the zips of the election data: name, bytes, sha256, source URL, Last-Modified
  RAW = new "#{RAW_DIR}/MANIFEST.tsv", %w[name bytes sha256 url last_modified]

  # the RDV and log parts of the first round of 2022: name, bytes, sha256, source URL, entries
  RDVLOG = new "#{RDVLOG_DIR}/MANIFEST.tsv", %w[name bytes sha256 url entries]
end
