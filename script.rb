require 'active_support/all'

%w[config peach http cache state ballot results rdv db schema stored votes voting_log section scraper].each{ |f| require_relative "lib/#{f}" }

Schema.setup
Scraper.run
