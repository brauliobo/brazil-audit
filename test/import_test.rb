# Imports the AC files of the year into a scratch database (created and dropped here) and checks the invariants of the
# import. Needs the zips in <year>/raw. From the root of the repository:  YEAR=2022 ruby test/import_test.rb
ENV['YEAR'] ||= '2018'
ENV['STATES'] = 'AC'
ENV['DB_NAME'] = "c#{ENV['YEAR'][2..]}_test"
system 'dropdb', '--if-exists', ENV['DB_NAME'], exception: true
system 'createdb', ENV['DB_NAME'], exception: true

require 'minitest/autorun'
require 'tmpdir'
require_relative '../lib/boot'

Schema.setup
Importer.run
Minitest.after_run{ DB.disconnect; system 'dropdb', ENV['DB_NAME'] }

class ImportTest < Minitest::Test
  SECTION = 'state, city_code, zone, section'

  def test_every_file_of_the_state_is_logged_and_classified
    assert_equal 8, DB[:imports].count # votacao_secao, detalhe, consulta_cand, candidato_munzona, 2 BU and 2 CEFT
    assert_equal 0, DB[:imports].sum(:unclassified).to_i
  end

  def test_rows_read_are_the_values_aggregated
    log = DB[:imports].where(Sequel.like(:name, 'votacao_secao_%')).first
    values = DB['SELECT count(*) FROM rdv_votes r, jsonb_each(r.votes) k, jsonb_each(k.value) n'].get
    assert_equal log[:rows] - log[:skipped], values
    assert_equal log[:votes], DB['SELECT sum(n.value::bigint) FROM rdv_votes r, jsonb_each(r.votes) k, jsonb_each(k.value) n'].get
  end

  def test_the_sections_are_the_same_in_every_table
    counts = %i[section_detail section_urn urn_match].map{ |t| DB["SELECT count(DISTINCT (#{SECTION})) FROM #{t} WHERE turn = 1"].get }
    assert_equal [counts.first] * 3, counts
    assert_operator DB["SELECT count(DISTINCT (#{SECTION})) FROM rdv_votes WHERE turn = 1"].get, :<=, counts.first
  end

  def test_votes_are_kinds_of_numbers
    kinds = DB['SELECT DISTINCT k.key FROM rdv_votes r, jsonb_each(r.votes) k'].select_map(:key)
    assert_empty kinds - %w[1 2 3 4 5]
    assert_equal [''], DB["SELECT DISTINCT n.key FROM rdv_votes r, jsonb_each(r.votes -> '3') n"].select_map(:key)
  end

  def test_a_resume_imports_nothing
    before = DB[:imports].select_map(:name).sort
    Importer.run
    assert_equal before, DB[:imports].select_map(:name).sort
  end

  def test_stray_quotes_do_not_merge_rows
    Dir.mktmpdir do |dir|
      File.write "#{dir}/t.csv", %("A";"B"\r\n"1";"ALICE SANT"ANA"\r\n"2";"PROF "ZE""\r\n"3";"C"\r\n)
      system 'zip', '-q', '-j', "#{dir}/t.zip", "#{dir}/t.csv", exception: true
      DB.transaction do
        table, lines = Staging.load "#{dir}/t.zip", 't.csv'
        assert_equal lines - 1, DB[table.to_sym].count
        assert_equal ['ALICE SANT"ANA', 'C', 'PROF "ZE"'], DB[table.to_sym].select_order_map(:b)
        raise Sequel::Rollback
      end
    end
  end
end
