# Downloads every source (WORKERS at a time, each file once) and writes the manifest
module Fetch
  def self.run
    FileUtils.mkdir_p RAW_DIR
    rows = Sources.all.peach{ |url| Download.run(url).tap{ |row| puts row.first(2).join(' ') } }
    Manifest.write rows
  end
end
