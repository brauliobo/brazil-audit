# Walks every state, city, zone and section; each state runs in its own process
module Scraper
  def self.run
    DB.disconnect # forked children must not share (and close) the parent's connection
    puts "== #{PHASES.join '+'}"
    STATES.peach(STATES.size){ |state| Process.wait fork{ scrape_state state } }
  end

  def self.scrape_state state
    state = state.downcase
    Hashie::Mash.new(JSON.parse State.get(state).data).abr.first.mu.peach{ |city| scrape_city state, city }
  end

  def self.scrape_city state, city
    return if ENV['CITY'] && city.nm != ENV['CITY']
    return if FETCH && RESULTS && Results.totalized(state, city).zero?

    city.zon.peach{ |zone| zone.sec.select{ |s| State.own? s }.peach{ |s| Section.handle state, city, zone.cd, s.ns } }
  end
end
