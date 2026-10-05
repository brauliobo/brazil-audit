# The official results, the same files the TSE site reads
module Results
  # sections already counted as totalized in a city; the others have nothing to download yet
  def self.totalized state, city
    url = "#{SITE}/ele#{YEAR}/#{RESULTS}/dados/#{state}/#{state}#{city.cd}-c0001-e00#{RESULTS}-u.json"
    JSON.parse(Http.get(url).body).dig('s', 'st').to_i
  end
end
