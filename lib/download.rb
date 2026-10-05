require 'net/http'
require 'digest'

# Downloads one file as published (never touched afterwards) into RAW_DIR and returns its manifest row:
# name, bytes, sha256, source URL, Last-Modified. A partial download stays in name.part and resumes where it stopped.
module Download
  AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

  def self.run url
    name = Sources.name url
    path = "#{RAW_DIR}/#{name}"
    head = head url
    size = head['Content-Length'].to_i
    fetch url, path, size unless File.size?(path) == size
    [name, size, Digest::SHA256.file(path).hexdigest, url, head['Last-Modified']]
  end

  def self.head url
    uri = URI url
    Net::HTTP.start(uri.host, uri.port, use_ssl: true){ |http| http.head uri.path, 'User-Agent' => AGENT }.tap(&:value)
  end

  def self.fetch url, path, size
    system 'curl', '--fail', '--silent', '--show-error', '--user-agent', AGENT, '--continue-at', '-', '--output', "#{path}.part", url, exception: true
    raise "#{path}: #{File.size "#{path}.part"} bytes, expected #{size}" unless File.size("#{path}.part") == size

    File.rename "#{path}.part", path
  end
end
