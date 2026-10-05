# Streams a CSV out of a zip into an UNLOGGED table of text columns named after the header (lowercase, no spaces), with
# COPY: the rows never go through Ruby. The TSE writes "#NULO#" for no value, which comes in as NULL.
# Must run inside the transaction that drops the table when it is done.
module Staging
  # the TSE does not escape the quotes inside a field (ALICE SANT"ANA) and COPY would take them as the end of the field and
  # merge the rows that follow: the ones between two characters of a field are doubled (twice, for A"B"C)
  QUOTES = %q(s/([^;"\r])"([^;"\r])/\1""\2/g)
  PIPE   = %(unzip -p "$1" "$2" | LC_ALL=C sed -E -e '#{QUOTES}' -e '#{QUOTES}')

  # returns the table and the lines of the file (the header included), to check them against its rows
  def self.load zip, entry
    table   = "stg_#{entry.downcase.gsub(/\W/, '_')}"
    columns = columns zip, entry
    lines   = 0
    DB.run "CREATE UNLOGGED TABLE #{table} (#{columns.map{ |c| "#{c} text" }.join(', ')})"
    DB.copy_into table.to_sym, data: chunks(zip, entry){ |chunk| lines += chunk.count("\n") }, format: :csv, options: options(columns)
    [table, lines]
  end

  def self.options(columns) = "DELIMITER ';', HEADER, ENCODING 'LATIN1', NULL '#NULO#', FORCE_NULL (#{columns.join ', '})"

  def self.columns zip, entry
    header = IO.popen(['unzip', '-p', zip, entry], &:gets)
    header.encode('UTF-8', 'ISO-8859-1').delete('"').strip.split(';').map{ |c| c.downcase.delete(' ') }
  end

  def self.chunks zip, entry, &seen
    Enumerator.new do |out|
      IO.popen(['bash', '-o', 'pipefail', '-c', PIPE, '--', zip, entry]) do |io|
        until io.eof?
          chunk = io.read 1 << 20
          seen.call chunk
          out << chunk
        end
      end
      raise "unzip #{zip} #{entry}: #{$?}" unless $?.success?
    end
  end
end
