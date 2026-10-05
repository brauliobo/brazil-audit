require 'seven_zip_ruby'
require 'zip'

# Reads the log of a section: sets its voting machine model and returns its voting times
module VotingLog
  def self.rows log, params
    logdat = read log.file
    params.model = logdat.match(/Modelo de Urna: (UE\d\d\d\d)/)&.captures&.first

    logdat.scan(/(.+ .+)\tINFO.+Voto confirmado para \[(.+)\]/).map do |time, post|
      params.merge post:, time: time.sub(%r{(\d+)/(\d+)/(\d+)}, '\3-\2-\1') # ISO, so it doesn't depend on DateStyle
    end
  end

  # 2022 logs are 7z archives, later years are zip
  def self.read file
    return Zip::File.open(file){ |zip| zip.read 'logd.dat' } unless LEGACY

    File.open(file, 'rb') do |f|
      SevenZipRuby::Reader.open(f){ |sz| return sz.extract_data sz.entries.find{ |ei| ei.path == 'logd.dat' } }
    end
  end
end
