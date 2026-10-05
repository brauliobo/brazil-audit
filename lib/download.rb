require 'digest'

# Downloads one file as published (never touched afterwards) into RAW_DIR and adds it to the manifest.
# An interrupted download stays in name.part and resumes where it stopped; a complete one gets its final name, but is
# only listed in the manifest (and trusted by the next run) when its size is the total the server announces.
module Download
  AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
  INFO  = '%header{content-range}\t%header{last-modified}'

  def self.run url
    name = Sources.name url
    path = "#{RAW_DIR}/#{name}"
    done = Manifest.rows[name]
    return done if done && File.size?(path) == done[1].to_i

    curl url, '--continue-at', '-', '--output', "#{path}.part"
    File.rename "#{path}.part", path
    Manifest.add(row url, path).tap{ puts "#{name} #{File.size path}" }
  end

  def self.row url, path
    range, modified = curl(url, '--range', '0-0', '--output', '/dev/null', '--write-out', INFO).split("\t")
    size = range[%r{/(\d+)}, 1].to_i
    raise "#{path}: #{File.size path} bytes, expected #{size}" unless File.size(path) == size

    [File.basename(path), File.size(path), Digest::SHA256.file(path).hexdigest, url, modified].map(&:to_s)
  end

  # the total comes from a 1 byte range request: the Content-Length of a plain GET is missing and the one of a HEAD
  # is 1 while the CDN has not cached the file yet
  def self.curl url, *args
    IO.popen(['curl', '--fail', '--silent', '--show-error', '--user-agent', AGENT, *args, url], &:read)
      .tap{ raise "curl #{url}: #{$?}" unless $?.success? }
  end
end
