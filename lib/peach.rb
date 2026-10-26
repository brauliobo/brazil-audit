module Enumerable

  def peach threads = nil, &block
    threads ||= (ENV['THREADS'] || '10').to_i

    return each(&block) if threads == 1

    queue   = SizedQueue.new threads
    workers = Array.new(threads) do
      Thread.new do
        while args = queue.pop
          begin
            block.call(*args)
          rescue => e
            puts "error: #{e.message}"
          end
        end
      end
    end

    begin
      each{ |*args| queue << args }
    ensure
      threads.times{ queue << nil }
      workers.each(&:join)
    end
  end

end
