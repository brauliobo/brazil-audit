# Each state runs in its own process, with one section pool shared by all its cities
module Scraper
  def self.run
    DB.disconnect # forked children must not share (and close) the parent's connection
    puts "== #{PHASES.join '+'}"
    STATES.peach(STATES.size){ |state| Process.wait fork{ scrape_state state } }
  end

  def self.scrape_state state
    state  = state.downcase
    cities = Hashie::Mash.new(JSON.parse State.get(state).data).abr.first.mu
    jobs   = Enumerator.new do |out|
      cities.each do |city|
        begin
          city_sections(state, city).each{ |zone, section| out << [state, city, zone, section] }
        rescue => e
          puts "error: #{e.message}"
        end
      end
    end
    jobs.peach(Http::SLOTS){ |state, city, zone, section| Section.handle state, city, zone, section }
  end

  # only the sections with files of their own that are not stored yet, so a resume touches nothing else
  def self.city_sections state, city
    return [] if ENV['CITY'] && city.nm != ENV['CITY']

    sections = city.zon.flat_map{ |zone| zone.sec.select{ |s| todo? state, city, zone, s }.map{ |s| [zone.cd, s.ns] } }
    return [] if sections.empty? || (FETCH && RESULTS && Results.totalized(state, city).zero?)

    sections
  end

  def self.todo? state, city, zone, section
    State.own?(section) && !Stored.section?(state, city.cd, zone.cd, section.ns)
  end
end
