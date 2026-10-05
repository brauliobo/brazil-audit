# Streams a CSV out of a zip into an UNLOGGED table of text columns named after the header (lowercase, no spaces), with
# COPY: the rows never go through Ruby. The TSE writes "#NULO#" for no value, which comes in as NULL.
# Must run inside the transaction that drops the table when it is done.
module Staging
  def self.load zip, entry
    table   = "stg_#{entry.downcase.gsub(/\W/, '_')}"
    columns = columns zip, entry
    DB.run "CREATE UNLOGGED TABLE #{table} (#{columns.map{ |c| "#{c} text" }.join(', ')})"
    DB.copy_into table.to_sym, data: chunks(zip, entry), format: :csv, options: options(columns)
    table
  end

  def self.options(columns) = "DELIMITER ';', HEADER, ENCODING 'LATIN1', NULL '#NULO#', FORCE_NULL (#{columns.join ', '})"

  def self.columns zip, entry
    header = IO.popen(['unzip', '-p', zip, entry], &:gets)
    header.encode('UTF-8', 'ISO-8859-1').delete('"').strip.split(';').map{ |c| c.downcase.delete(' ') }
  end

  def self.chunks zip, entry
    Enumerator.new do |out|
      IO.popen(['unzip', '-p', zip, entry]){ |io| out << io.read(1 << 20) until io.eof? }
      raise "unzip #{zip} #{entry}: #{$?}" unless $?.success?
    end
  end
end
