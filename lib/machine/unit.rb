module Machine
  # The rows of one unit (a round, a state and a zone), as the text of COPY: the votes of the RDV, the voting times of the log
  # and a row per section saying which files it had and what they gave
  module Unit
    Result = Struct.new :votes, :times, :sections, :stats

    def self.build turn, uf, zone, sections, cities
      result = Result.new +'', +'', +'', Hash.new(0)
      sections.sort.each do |(city, section), files|
        key = [uf.downcase, cities.fetch(city), city, zone, section]
        rdvs = files[:rdvs].sort
        add result, key, turn, rdvs.first && Rdv.votes(Source.read rdvs.first), files[:logs].sort.map{ |ref| VotingLog.read Source.read(ref) }, rdvs.size
      end
      result
    end

    # each event has the model of its own log, and only the ones of the day of the round count (the urn of the second round has
    # the first one in its log); the votes have the model of the first log. A second RDV of a section is not stored.
    def self.add result, key, turn, rdv, logs, rdvs
      all     = logs.map{ |log| [log, VotingLog.events(log)] }
      events  = all.flat_map{ |log, evs| evs.select{ |_, time| time.start_with? MACHINE[:days][turn] }.map{ |post, time| [VotingLog.model(log), post, time] } }
      garbled = all.sum{ |log, evs| VotingLog.garbled log, evs }
      other   = all.sum{ |_, evs| evs.size } - events.size
      ballots = rdv ? rdv.values.sum{ |kinds| kinds.values.sum{ |numbers| numbers.values.sum } } : 0
      model   = logs.first && VotingLog.model(logs.first)
      times   = events.map(&:last)
      rdv&.each{ |office, kinds| result.votes << line(*key, model, turn, office, JSON.generate(kinds)) }
      events.each{ |event_model, post, time| result.times << line(*key, event_model, turn, post, time) }
      result.sections << line(*key, turn, model, rdvs, logs.size, ballots, events.size, other, garbled, times.min, times.max)
      { sections: 1, rdv: rdv ? 1 : 0, logs: logs.size, ballots:, events: events.size, garbled:, skipped: other + [rdvs - 1, 0].max }.each{ |k, v| result.stats[k] += v }
    end

    # a line of COPY text, nil being \N
    def self.line(*fields) = fields.map{ |f| f.nil? ? '\N' : f.to_s }.join("\t") << "\n"
  end
end
