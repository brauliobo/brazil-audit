# Downloads every source, WORKERS at a time, each file once
module Fetch
  def self.run
    FileUtils.mkdir_p RAW_DIR
    Sources.all.peach{ |url| Download.run url }
  end
end
