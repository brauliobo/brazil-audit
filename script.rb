require 'active_support/all'
require 'httpclient'
require 'mechanize'
require 'hashie'

require 'iconv'
require 'rasn1'
require 'seven_zip_ruby'

require 'sqlite3'
require 'pg'
require 'sequel'

require_relative 'peach'

CDP    = 407
states = ENV['STATES']&.split(' ') || %w[
  AC AL AM AP BA CE DF ES GO MA
  MG MS MT PA PB PE PI
  PR RJ RN RO RR RS
  SC SE SP TO
  ZZ
].reverse

HEADERS   = {
  'Accept'  => 'application/json, text/plain, */*',
  'Referer' => 'https://resultados.tse.jus.br/oficial/app/index.html',
}
USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.36'

def http
  http = HTTPClient.new
  http.agent_name = USER_AGENT
  http
end
def http
  http = Mechanize.new
  http.agent.user_agent = USER_AGENT
  http.set_proxy ENV['PHOST'], ENV['PPORT'], ENV['PUSER'], ENV['PPASS'] if ENV['PHOST']
  http
end

def cached_get id, url, prefix:
  file   = "#{prefix}/#{id}"
  data   = File.read file if File.exists? file
  data ||= self.then do
    puts "GET #{url}"
    resp = http.get url, nil, HEADERS['Referer'], HEADERS
    File.write file, resp.body
    resp.body
  end
  Hashie::Mash.new data: data, file: file
end

class State
  URL = "https://resultados.tse.jus.br/oficial/ele2022/arquivo-urna/#{CDP}/config/%{state}/%{state}-p000#{CDP}-cs.json"

  def get s
    s.downcase!
    url = URL % {state: s}
    cached_get s, url, prefix: 'states'
  end
end

class Ballot
  INFO_URL = "https://resultados.tse.jus.br/oficial/ele2022/arquivo-urna/#{CDP}/dados/%{state}/%{city}/%{zone}/%{section}/p000#{CDP}-%{state}-m%{city}-z%{zone}-s%{section}-aux.json"

  def info_get state, city, zone, section
    url = INFO_URL % {state: state, city: city, zone: zone, section: section}
    id  = "#{state}-#{city}-#{zone}-#{section}"
    cached_get id, url, prefix: 'ballots'
  end

  FILE_URL = "https://resultados.tse.jus.br/oficial/ele2022/arquivo-urna/#{CDP}/dados/%{state}/%{city}/%{zone}/%{section}/%{hash}/%{file}"

  def file_get state, city, zone, section, hash, file
    url = FILE_URL % {state: state, city: city, zone: zone, section: section, hash: hash, file: file}
    id  = "#{state}-#{city}-#{zone}-#{section}-#{hash}-#{file}"
    cached_get id, url, prefix: 'files'
  end
end

BASE_FIELDS = %i[state city zone section model]

#DB = Sequel.sqlite 'db.sqlite3'
DB = Sequel.connect adapter: 'postgres', database: 'brazil-audit', max_connections: 5, pool_timeout: 2.minutes.to_i
Sequel.extension :core_extensions
DB.create_table :votes do
  BASE_FIELDS.each{ |f| String f }
  Integer :votes_13
  Integer :votes_22

  index [:state, :city, :zone, :section, :model], unique: true
end unless :votes.in? DB.tables
DB.create_table :voting_times do
  BASE_FIELDS.each{ |f| String f }
  String :post
  Time   :time
end unless :voting_times.in? DB.tables

%i[votes voting_times].each do |table|
  BASE_FIELDS.each do |f|
    DB.execute "alter table #{table} alter column #{f} set storage main"
  end
end


def handle_rdv rdv, params
  r  = rdv.data.bytes.pack("C*").split("\n").select{ |l| l.index "\x01\x02\x12" }
  vr = r.map{ |l| l.match(/\02(\d\d)0/)&.captures&.first }.compact
  vr = vr.chunk{ |y| y }.map{|y, ys| [y, ys.length] }.first(2)
  v13 = vr.find{ |n,v| n == '13' }&.last || 0
  v22 = vr.find{ |n,v| n == '22' }&.last || 0
  
  DB[:votes].insert params.merge(
    votes_13: v13,
    votes_22: v22,
  )
rescue Sequel::UniqueConstraintViolation
end

def handle_log log, params
  logdat = nil; File.open(log.file, 'rb') do |f|
    SevenZipRuby::Reader.open(f) do |sz|
      logdat = sz.extract_data sz.entries.find{ |ei| ei.path == 'logd.dat' }
    end
  end

  params.model = logdat.match(/Modelo de Urna: (UE\d\d\d\d)/)&.captures&.first

  times = logdat.scan(/(.+ .+)\tINFO.+Voto confirmado para \[(.+)\]/).map do |time, post|
    params.merge post: post, time: time
  end
  DB[:voting_times].multi_insert times
end

states.peach do |st|
  Process.wait(pid = fork do
    sdata = Hashie::Mash.new JSON.parse State.new.get(st).data
    cities = sdata.abr.first.mu
    cities.peach do |c|
      next unless c.nm == ENV['CITY'] if ENV['CITY']
      zones = c.zon
      zones.peach do |z|
        sections = z.sec
        sections.peach do |s|
          city    = c.nm
          zone    = z.cd
          section = s.ns
          puts "#{st}/#{city}/#{zone}/#{section}"
          ballot  = Ballot.new
          bdata   = Hashie::Mash.new JSON.parse ballot.info_get(st, c.cd, zone, section).data
          bdata.hashes.peach do |hash|
            log    = ballot.file_get st, c.cd, zone, section, hash[:hash], hash.nmarq.find{ |f| f.index '.log' }
            params = Hashie::Mash.new(
              state:    st,
              city:     city,
              zone:     zone,
              section:  section,
            )
            handle_log log, params

            next if ENV['RDV_SKIP']
            rdv = ballot.file_get st, c.cd, zone, section, hash[:hash], hash.nmarq.find{ |f| f.index '.rdv' }
            handle_rdv rdv, params
          end
        end
      end
    end
  end)
end



