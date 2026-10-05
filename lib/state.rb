# Cities, zones and sections of a state
module State
  URL = "#{BASE_URL}/config/%{state}/%{state}-#{PLEITO}-cs.json"

  def self.get state, **opts
    Cache.get URL, { state: }, prefix: 'states', **opts
  end

  # aggregated sections (nsp is the section that holds their votes) have no files of their own
  def self.own? section
    section.nsp.nil? || section.nsp == section.ns
  end
end
