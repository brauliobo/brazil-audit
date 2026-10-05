# Imports the voting machine files of AC (both rounds) in a scratch database (created and dropped here) after the open data of AC and
# the president, and compares them. Needs the zips of 2022/raw, 2022/rdvlog and the files of the portal collector (MACHINE[:legacy]).
# From the root of the repository:  ruby test/machine_test.rb
ENV['YEAR']    = '2022'
ENV['STATES']  = 'AC BR'
ENV['DB_NAME'] = 'c22_machine_test'
system 'dropdb', '--if-exists', ENV['DB_NAME'], exception: true
system 'createdb', ENV['DB_NAME'], exception: true

require 'minitest/autorun'
require_relative '../lib/boot'

Schema.setup
Importer.run
ENV['STATES'] = 'AC'
Machine::Import.run
Minitest.after_run{ DB.disconnect; system 'dropdb', ENV['DB_NAME'] }

class MachineTest < Minitest::Test
  # the RDV keeps the digits typed (legend votes by party: 2 digits) and the null of the open data is the kind 4 and 6 of the RDV
  NORMALIZED = <<~SQL
    SELECT state, city_code, zone, section, turn, office, CASE k.key WHEN '6' THEN 4 ELSE k.key::int END kind,
           CASE k.key WHEN '1' THEN left(n.key, 2) WHEN '2' THEN n.key ELSE '' END number, sum(n.value::bigint) votes
    FROM rdv_machine m, jsonb_each(m.votes) k, jsonb_each(k.value) n GROUP BY 1, 2, 3, 4, 5, 6, 7, 8
  SQL

  def test_the_votes_of_the_rdv_are_the_ones_of_the_open_data
    open = "SELECT state, city_code, zone, section, turn, office, k.key::int kind, CASE WHEN k.key IN ('1', '2') THEN n.key ELSE '' END number,
                   sum(n.value::bigint) votes FROM rdv_votes m, jsonb_each(m.votes) k, jsonb_each(k.value) n GROUP BY 1, 2, 3, 4, 5, 6, 7, 8"
    keys = '(state, city_code, zone, section, turn, office, kind, number, votes)'
    assert_equal 0, DB["SELECT count(*) FROM (SELECT #{keys} FROM (#{NORMALIZED}) a EXCEPT SELECT #{keys} FROM (#{open}) b) d"].get
    assert_equal 0, DB["SELECT count(*) FROM (SELECT #{keys} FROM (#{open}) b WHERE state = 'ac' EXCEPT SELECT #{keys} FROM (#{NORMALIZED}) a) d"].get
  end

  def test_every_section_has_its_files_in_both_rounds
    assert_equal [[1, 2124], [2, 2124]], DB['SELECT turn, count(*) FROM machine_sections GROUP BY 1 ORDER BY 1'].map(&:values)
    assert_equal 0, DB[:machine_sections].where(Sequel.|({ rdvs: 0 }, { logs: 0 })).count
    assert_equal 0, DB[:imports].where(Sequel.like(:name, 'machine/%')).sum(:unclassified).to_i
  end

  def test_the_voting_times_are_the_ones_of_the_day_of_the_round
    days = DB['SELECT DISTINCT turn, time::date FROM voting_times ORDER BY 1, 2'].map(&:values)
    assert_equal [[1, Date.parse('2022-10-02')], [2, Date.parse('2022-10-30')]], days
    assert_equal DB[:voting_times].count, DB[:machine_sections].sum(:events)
  end

  def test_the_votes_are_confirmed_inside_the_opening_of_the_section
    outside = DB['SELECT count(*) FROM machine_sections s JOIN section_urn u USING (state, city_code, zone, section, turn)
                  WHERE s.first_vote < u.opened_at OR s.last_vote > u.closed_at'].get
    assert_equal 0, outside
  end

  def test_a_resume_imports_nothing
    before = DB[:voting_times].count
    Machine::Import.run
    assert_equal before, DB[:voting_times].count
  end
end
