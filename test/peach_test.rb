ENV['MT_NO_PLUGINS'] = '1'
require 'minitest/autorun'
require 'timeout'
require_relative '../lib/peach'

class PeachTest < Minitest::Test
  def test_bounds_workers_and_prefetched_jobs_and_preserves_arguments
    started  = Queue.new
    release  = Queue.new
    produced = Queue.new
    seen     = Queue.new
    source   = Enumerator.new do |out|
      20.times do |n|
        produced << n
        out << [n, n + 1]
      end
    end
    worker = Thread.new do
      source.peach(2) do |a, b|
        started << true
        release.pop
        seen << [a, b]
      end
    end
    begin
      Timeout.timeout(2) { 2.times { started.pop }; 5.times { produced.pop } }
      assert_equal 0, produced.size # 2 active, 2 queued, 1 producer waiting to enqueue
      assert_equal 0, started.size
    ensure
      20.times { release << true }
      worker.join
    end
    assert_equal (0...20).map { |n| [n, n + 1] }, Array.new(20) { seen.pop }.sort
  end

  def test_producer_failure_joins_workers
    seen   = Queue.new
    source = Enumerator.new { |out| out << 1; raise 'producer failed' }
    error  = assert_raises(RuntimeError) { source.peach(2) { |n| seen << n } }
    assert_equal 'producer failed', error.message
    assert_equal 1, seen.pop
  end

  def test_worker_error_does_not_drop_following_jobs
    seen = Queue.new
    out, = capture_io do
      [1, 2, 3].peach(2) do |n|
        raise 'section failed' if n == 2
        seen << n
      end
    end
    assert_equal "error: section failed\n", out
    assert_equal [1, 3], Array.new(2) { seen.pop }.sort
  end
end
