require 'active_support/all'
require 'fileutils'

%w[config peach sources download manifest fetch db schema sql].each{ |f| require_relative "lib/#{f}" }
Dir[File.join __dir__, 'lib/targets/*.rb'].each{ |f| require f }
%w[staging importer].each{ |f| require_relative "lib/#{f}" }

Fetch.run if PHASES.include? 'fetch'

if PHASES.include? 'import'
  Schema.setup
  Importer.run
end
