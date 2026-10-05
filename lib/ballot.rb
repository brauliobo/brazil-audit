# The files of a voting section: its info (one entry per hash) and the files listed there
module Ballot
  INFO_URL = "#{BASE_URL}/dados/%{state}/%{city}/%{zone}/%{section}/#{PLEITO}-%{state}-m%{city}-z%{zone}-s%{section}-aux.json"
  FILE_URL = "#{BASE_URL}/dados/%{state}/%{city}/%{zone}/%{section}/%{hash}/%{file}"

  def self.info state, city, zone, section, **opts
    Cache.get INFO_URL, { state:, city:, zone:, section: }, prefix: 'ballots', **opts
  end

  def self.info_cached? state, city, zone, section
    File.exist? Cache.path('ballots', { state:, city:, zone:, section: })
  end

  def self.file state, city, zone, section, hash, file, **opts
    Cache.get FILE_URL, { state:, city:, zone:, section:, hash:, file: }, prefix: 'files', **opts
  end

  # 2022 lists `nmarq` (file names); later years list `arq` ({nm, tp})
  def self.file_name hash, type
    hash.arq ? hash.arq.find{ |a| a.tp == type }.nm : hash.nmarq.find{ |f| f.index ".#{type}" }
  end
end
