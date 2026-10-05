require 'mechanize'

module Http
  REFERER    = "#{SITE}/app/index.html"
  HEADERS    = { 'Accept' => 'application/json, text/plain, */*', 'Referer' => REFERER }
  USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.36'
  # rate limits (429, 466 from the proxy) and transient network errors
  RETRY      = /\A(429|466)\b|SSL_connect|Connection|Timeout/
  # file with one `host port user pass` per line; each request picks one at random
  PROXIES    = ENV['PROXIES'] && File.readlines(ENV['PROXIES']).map(&:split)

  def self.client
    Mechanize.new.tap do |http|
      http.agent.user_agent = USER_AGENT
      http.set_proxy(*PROXIES.sample) if PROXIES
    end
  end

  # retried up to 8 times, each attempt through another proxy
  def self.get url
    attempts = 0
    begin
      client.get url, nil, REFERER, HEADERS
    rescue => e
      raise unless e.message.match?(RETRY) && (attempts += 1) < 8
      sleep rand(0.5..2.0)
      retry
    end
  end
end
