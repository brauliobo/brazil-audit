module Enumerable

  # runs the block on a pool of WORKERS threads and raises the first error once every item has finished
  def peach threads = WORKERS, &block
    pool    = Concurrent::FixedThreadPool.new threads
    futures = map{ |*args| Concurrent::Promises.future_on(pool, *args, &block) }
    futures.each(&:wait)
    futures.map(&:value!)
  ensure
    pool.shutdown
  end

end
