# Streams a CSV out of a zip into an UNLOGGED table of text columns named after the header (lowercase, no spaces), with
# COPY: the rows never go through Ruby. Must run inside the transaction that drops the table when it is done.
module Staging
  OPTIONS = "DELIMITER ';', HEADER, ENCODING 'LATIN1'"

  def self.load zip, entry
    table = "stg_#{entry.downcase.gsub(/\W/, '_')}"
    DB.run "CREATE UNLOGGED TABLE #{table} (#{columns(zip, entry).map{ |c| "#{c} text" }.join(', ')})"
    DB.copy_into table.to_sym, data: chunks(zip, entry), format: :csv, options: OPTIONS
    table
  end

  def self.columns zip, entry
    IO.popen(['unzip', '-p', zip, entry], &:gets).encode('UTF-8', 'ISO-8859-1').delete('"').strip.split(';').map{ |c| c.downcase.delete(' ') }
  end

  def self.chunks zip, entry
    Enumerator.new do |out|
      IO.popen(['unzip', '-p', zip, entry]){ |io| out << io.read(1 << 20) until io.eof? }
      raise "unzip #{zip} #{entry}: #{$?}" unless $?.success?
    end
  end
end
