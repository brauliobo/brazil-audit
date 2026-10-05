require 'seven_zip_ruby'
require 'zip'

# Reads the log of a section: sets its voting machine model and returns its voting times
module VotingLog
  # anchored on whole lines: a few logs have garbled bytes and glued lines, which a looser match turns into bad timestamps
  EVENT = %r{^(\d\d)/(\d\d)/(\d{4}) (\d\d:\d\d:\d\d)\tINFO\t\d+\tVOTA\tVoto confirmado para \[([^\]]+)\]}

  def self.rows log, params
    logdat = read log.file
    params.model = logdat.match(/Modelo de Urna: (UE\d\d\d\d)/)&.captures&.first

    logdat.scan(EVENT).map do |day, month, year, time, post|
      params.merge post:, time: "#{year}-#{month}-#{day} #{time}" # ISO, so it doesn't depend on DateStyle
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
