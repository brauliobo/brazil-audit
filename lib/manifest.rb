# RAW_DIR/MANIFEST.tsv: the release assets of `data-2018` with the checksums to verify them. A row is added when its
# download finishes, so a resume only downloads what is not listed.
module Manifest
  PATH   = "#{RAW_DIR}/MANIFEST.tsv"
  HEADER = %w[name bytes sha256 url last_modified]
  LOCK   = Mutex.new
  ROWS   = File.exist?(PATH) ? File.readlines(PATH, chomp: true).drop(1).to_h{ |line| [line[/^[^\t]+/], line.split("\t")] } : {}

  def self.rows = ROWS

  def self.add row
    LOCK.synchronize do
      ROWS[row.first] = row
      File.write PATH, ([HEADER] + ROWS.values.sort).map{ |r| r.join("\t") + "\n" }.join
    end
  end
end
