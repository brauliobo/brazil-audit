module Enumerable

  def peach threads = nil, &block
    threads ||= (ENV['THREADS'] || '10').to_i

    return each(&block) if threads == 1

    pool = Concurrent::FixedThreadPool.new threads
    ret  = each do |*args|
      pool.post do
        block.call(*args)
      rescue => e
        puts "error: #{e.message}"
      end
    end

    pool.shutdown
    pool.wait_for_termination
    ret
  end

end
