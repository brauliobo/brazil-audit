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

  # only the sections with files of their own that are not stored yet, so a resume touches nothing else
  def self.scrape_city state, city
    return if ENV['CITY'] && city.nm != ENV['CITY']

    sections = city.zon.flat_map{ |zone| zone.sec.select{ |s| todo? state, city, zone, s }.map{ |s| [zone.cd, s.ns] } }
    return if sections.empty? || (FETCH && RESULTS && Results.totalized(state, city).zero?)

    sections.peach{ |zone, section| Section.handle state, city, zone, section }
  end

  def self.todo? state, city, zone, section
    State.own?(section) && !Stored.section?(state, city.cd, zone.cd, section.ns)
  end
end
