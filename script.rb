require 'active_support/all'
require 'fileutils'

%w[config peach sources download manifest fetch].each{ |f| require_relative "lib/#{f}" }

Fetch.run if PHASES.include? 'fetch'
