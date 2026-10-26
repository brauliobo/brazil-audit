ENV['MT_NO_PLUGINS'] = '1'
require 'minitest/autorun'
require 'json'
require 'hashie'
require 'timeout'
require_relative '../lib/peach'
require_relative '../lib/scraper'

FETCH   = true
RESULTS = 6258
module Http
  SLOTS = 8
end
module State
  class << self; attr_accessor :response; end
  def self.get(state); response; end
  def self.own?(section); section.nsp.nil? || section.nsp == section.ns; end
end
module Stored
  class << self; attr_accessor :handler; end
  def self.section?(*key); handler.call(*key); end
end
module Results
  class << self; attr_accessor :handler; end
  def self.totalized(state, city); handler.call(state, city); end
end
module Section
  class << self; attr_accessor :handler; end
  def self.handle(*args); handler.call(*args); end
end

class ScraperTest < Minitest::Test
  def setup
    @threads       = ENV['THREADS']
    @city          = ENV.delete 'CITY'
    ENV['THREADS'] = '2'
  end

  def teardown
    @threads ? ENV['THREADS'] = @threads : ENV.delete('THREADS')
    @city ? ENV['CITY'] = @city : ENV.delete('CITY')
  end

  def city(code, sections)
    { cd: code, nm: code, zon: [{ cd: '1', sec: sections }] }
  end

  def scrape(cities, handler, stored = ->(*) { false }, totalized = ->(*) { 1 })
    State.response  = Struct.new(:data).new(JSON.generate(abr: [{ mu: cities }]))
    Stored.handler  = stored
    Results.handler = totalized
    Section.handler = handler
    Scraper.scrape_state 'SP'
  end

  def test_one_city_can_fill_the_http_capacity
    started = Queue.new
    release = Queue.new
    handler = ->(*) { started << true; release.pop }
    worker  = Thread.new { scrape [city('capital', (1..Http::SLOTS).map { |n| { ns: n.to_s } })], handler }
    begin
      Timeout.timeout(2) { Http::SLOTS.times { started.pop } }
    ensure
      Http::SLOTS.times { release << true }
      worker.join
    end
  end

  def test_cities_share_one_worker_limit
    started = Queue.new
    release = Queue.new
    seen    = Queue.new
    handler = ->(*) { started << true; release.pop; seen << Thread.current.object_id }
    cities  = (1..3).map { |n| city(n.to_s, (1..4).map { |section| { ns: section.to_s } }) }
    worker  = Thread.new { scrape cities, handler }
    begin
      Timeout.timeout(2) { Http::SLOTS.times { started.pop } }
      assert_equal 0, started.size
    ensure
      12.times { release << true }
      worker.join
    end
    assert_equal Http::SLOTS, Array.new(12) { seen.pop }.uniq.size
  end

  def test_failed_city_does_not_skip_other_cities
    seen    = Queue.new
    handler = ->(state, city, *) { seen << city.cd }
    ready   = ->(state, city) { raise 'results unavailable' if city.cd == 'failed'; 1 }
    out, = capture_io do
      scrape [city('failed', [{ ns: '1' }]), city('ready', [{ ns: '2' }])], handler, ->(*) { false }, ready
    end
    assert_equal "error: results unavailable\n", out
    assert_equal 'ready', seen.pop
  end

  def test_filters_preserve_city_ownership_resume_and_totalization
    seen    = []
    mutex   = Mutex.new
    handler = ->(*args) { mutex.synchronize { seen << [args[0], args[1].cd, *args[2..]] } }
    cities  = [city('done', [{ ns: '1' }]), city('pending', [{ ns: '2' }]),
               city('capital', [{ ns: '3', nsp: '9' }, { ns: '4' }, { ns: '5' }])]
    stored  = ->(state, code, zone, section) { code == 'done' || section == '4' }
    ready   = ->(state, item) { item.cd == 'pending' ? 0 : 1 }
    scrape cities, handler, stored, ready
    assert_equal [['sp', 'capital', '1', '5']], seen
    ENV['CITY'] = 'pending'
    seen.clear
    scrape cities, handler, stored, ready
    assert_empty seen
  end
end
