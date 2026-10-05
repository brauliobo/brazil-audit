require 'hashie'

# Every TSE file is downloaded once and kept under DATA_DIR/<prefix>/<url params joined by '-'>
module Cache
  PREFIXES = %w[states ballots files]

  PREFIXES.each{ |prefix| FileUtils.mkdir_p "#{DATA_DIR}/#{prefix}" }

  def self.path prefix, params
    "#{DATA_DIR}/#{prefix}/#{params.values.join '-'}"
  end

  # with `fetch: false` it only reads the cache and returns nil when the file is not there; `refresh: true` downloads it again
  def self.get template, params, prefix:, fetch: true, refresh: false
    file = path prefix, params
    data = File.exist?(file) && !refresh ? File.read(file) : (download template % params, file if fetch)
    Hashie::Mash.new data: data, file: file if data
  end

  def self.download url, file
    puts "GET #{url}"
    Http.get(url).body.tap do |body| # renamed when complete, so an interrupted write never leaves a partial file
      File.write "#{file}.part", body
      File.rename "#{file}.part", file
    end
  end
end
