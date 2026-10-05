# RAW_DIR/MANIFEST.tsv: what the release assets of `data-2018` are, with the checksums to verify them
module Manifest
  PATH = "#{RAW_DIR}/MANIFEST.tsv"

  def self.write rows
    File.write PATH, ([%w[name bytes sha256 url last_modified]] + rows.sort).map{ |row| row.join("\t") + "\n" }.join
  end
end
