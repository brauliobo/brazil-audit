module Machine
  # Imports the RDV votes and the voting times of the units of Source, in WORKERS processes (the parsing is CPU, not SQL), each
  # unit in one transaction that also logs it in `imports` (name machine/<turn>t/<uf>/<zone>: sections, events, ballots, lines of
  # a vote that did not match), so a resume only does the units not logged.
  module Import
    COPIES = {
      votes:    [:rdv_machine,      %i[state city city_code zone section model turn office votes]],
      times:    [:voting_times,     %i[state city city_code zone section model turn post time]],
      sections: [:machine_sections, %i[state city city_code zone section turn model rdvs logs ballots events other_days garbled first_vote last_vote]]
    }

    def self.run
      done  = DB[:imports].select_map(:name).to_set
      units = Source.units.select{ |(_, uf, _), _| Importer::UNITS.include? uf }.reject{ |key, _| done.include? name(key) }
      puts "#{units.size} units, #{units.values.sum(&:size)} sections"
      DB.disconnect # the workers connect on their own
      buckets(units).map{ |bucket| fork { work bucket } }.each{ |pid| Process.wait pid; raise 'a worker failed' unless $?.success? }
    end

    # the units go to the worker that has the least sections so far, the biggest first
    def self.buckets units
      Array.new(WORKERS){ [] }.tap do |buckets|
        units.sort_by{ |_, sections| -sections.size }.each{ |unit| buckets.min_by{ |b| b.sum{ |_, s| s.size } } << unit }
      end
    end

    def self.work bucket
      cities = DB[:section_detail].distinct.select_hash(:city_code, :city)
      bucket.each{ |key, sections| unit key, sections, cities }
    rescue Exception => e
      warn "#{e.class}: #{e.message}", e.backtrace.first(8)
      exit! 1
    else
      $stdout.flush
      exit! 0
    end

    def self.unit key, sections, cities
      turn, uf, zone = key
      result = Unit.build turn, uf, zone, sections, cities
      DB.transaction do
        COPIES.each{ |part, (table, columns)| DB.copy_into table, columns:, data: result.public_send(part), format: :text }
        stats = result.stats
        DB[:imports].insert name: name(key), rows: stats[:sections], loaded: stats[:events], votes: stats[:ballots], unclassified: stats[:garbled],
                            skipped: stats[:skipped], at: Time.now
      end
      puts "#{name key} #{result.stats}"
    end

    def self.name(key) = "machine/#{key[0]}t/#{key[1].downcase}/#{key[2]}"
  end
end
