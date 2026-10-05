require 'active_support/all'
require 'fileutils'

%w[config peach sources download manifest fetch db schema sql].each{ |f| require_relative f }
Dir[File.join __dir__, 'targets/*.rb'].each{ |f| require f }
%w[staging importer].each{ |f| require_relative f }
