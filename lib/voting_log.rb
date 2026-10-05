require 'seven_zip_ruby'
require 'stringio'

# Reads the log of a section (a .logjez, a 7z archive with logd.dat): its voting machine model and its voting times.
# The model and the line of an event are the ones of the 2026 collector.
module VotingLog
  # anchored on whole lines: a few logs have garbled bytes and glued lines, which a looser match turns into bad timestamps
  EVENT = %r{^(\d\d)/(\d\d)/(\d{4}) (\d\d:\d\d:\d\d)\tINFO\t\d+\tVOTA\tVoto confirmado para \[([^\]]+)\]}
  MODEL = /Modelo de Urna: (UE\d\d\d\d)/

  # the text of logd.dat
  def self.read archive
    SevenZipRuby::Reader.open(StringIO.new archive){ |sz| return sz.extract_data sz.entries.find{ |ei| ei.path == 'logd.dat' } }
  end

  def self.model(logdat) = logdat.match(MODEL)&.captures&.first

  # [[post, time]], the time in ISO, so it doesn't depend on DateStyle
  def self.events logdat
    logdat.scan(EVENT).map{ |day, month, year, time, post| [post, "#{year}-#{month}-#{day} #{time}"] }
  end

  # the lines of a confirmed vote the EVENT does not match
  def self.garbled(logdat, events) = logdat.scan('Voto confirmado').size - events.size
end
