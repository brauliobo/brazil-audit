# The RDV and the log of every section of the first round, from the arqurnatot packages of the CDN (70 GiB, most of it the
# BU, its image and the vote summary): the central directory of each package is read with Range requests and only the .rdv
# and log entries are downloaded, checked (CRC and size) and packed by state in RDVLOG_DIR. A resume skips what the finished
# parts hold.
module RdvlogFetch
  ROUND  = '1t'
  WANTED = /\.(rdv|log\w*)$/ # .logjez, and .logsajez of the sections with a separate count
  WARM   = 512 << 20 # a package the CDN has not cached answers without Range: it is read once, up to this much, to cache it

  def self.run
    FileUtils.mkdir_p RDVLOG_DIR
    ufs = Importer::UNITS - %w[BR]
    ((ufs & %w[SP]) + (ufs - %w[SP])).peach{ |uf| state uf }
  end

  def self.state uf
    FileUtils.rm_f Dir["#{RDVLOG_DIR}/*.part"].select{ |f| f.include? "-#{uf.downcase}-" }
    url  = MACHINE[:url] % { round: ROUND, uf: }
    pack = RdvlogPack.new ROUND, uf, url, Manifest::RDVLOG
    zip  = RemoteZip.new url
    done = pack.done
    todo = entries(zip).select{ |entry| entry.name.match?(WANTED) && !done.include?(entry.name) }
    zip.read(todo){ |batch| batch.each{ |name, data| pack.add name, data } }
    pack.finish
    puts "#{uf}: #{pack.added} entries, #{zip.transferred} bytes transferred"
  end

  def self.entries zip
    zip.entries
  rescue RemoteZip::RangeNotHonoured
    zip.warm WARM
    zip.entries
  end
end
