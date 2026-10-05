# Reads a few entries of the AC package of the first round of 2022 from the CDN with Range requests (about 3 MB of the 297 MiB) and
# compares them with the ones in the part of 2022/rdvlog. From the root of the repository:  YEAR=2022 ruby test/remote_zip_test.rb
ENV['YEAR'] = '2022'
require 'minitest/autorun'
require_relative '../lib/boot'

class RemoteZipTest < Minitest::Test
  URL = MACHINE[:url] % { round: RdvlogFetch::ROUND, uf: 'AC' }

  def setup
    @zip = RemoteZip.new URL
  end

  def test_the_central_directory_lists_every_section_file
    kinds = @zip.entries.group_by{ |e| e.name[/\.(\w+)$/, 1] }.transform_values(&:size)
    assert_equal({ 'bu' => 2124, 'imgbu' => 2124, 'logjez' => 2124, 'rdv' => 2124, 'vscmr' => 2124, 'pdf' => 1 }, kinds)
    assert_operator @zip.transferred, :<, 2 << 20
  end

  def test_the_entries_read_are_the_ones_of_the_part
    picked = @zip.entries.select{ |e| e.name.match? RdvlogFetch::WANTED }.first 60
    read   = {}
    @zip.read(picked){ |batch| read.merge! batch }
    local = Zip::File.open "#{RDVLOG_DIR}/#{YEAR}-1t-rdv-logs-ac-01.zip"
    assert_equal 60, read.size
    read.each{ |name, data| assert_equal local.read(name), data, name }
    assert_operator @zip.transferred, :<, 4 << 20
  end

  def test_a_wrong_checksum_is_an_error
    entry = @zip.entries.find{ |e| e.name.end_with? '.rdv' }
    entry.crc ^= 1
    assert_raises(RuntimeError){ @zip.read([entry]){} }
  end
end
