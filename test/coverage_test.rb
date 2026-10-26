ENV['MT_NO_PLUGINS'] = '1'
require 'minitest/autorun'
require 'set'

class CoverageTest < Minitest::Test
  def test_output_names_follow_the_source_election
    source = File.read(File.expand_path('../bin/coverage', __dir__)).lines.reject { |line| line.start_with?('require ', '%w[') }.join
    [['2026', false, '2026'], ['2026-2', false, '2026-2'], ['.', true, '2022']].each do |directory, legacy, election|
      context = Module.new
      context.const_set :DATA_DIR, directory
      context.const_set :LEGACY, legacy
      context.const_set :YEAR, legacy ? '2022' : '2026'
      context.const_set :STATES, []
      paths = []
      context.const_set :Dir, Module.new { define_singleton_method(:children) { |*| [] } }
      context.const_set :FileUtils, Module.new { define_singleton_method(:mkdir_p) { |*| nil } }
      context.const_set :File, Module.new { define_singleton_method(:write) { |path, *| paths << path } }
      capture_io { context.module_eval(source) }
      assert_equal ["coverage/missing-#{election}.tsv", "coverage/summary-#{election}.tsv"], paths
    end
  end
end
