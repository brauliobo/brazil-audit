# One voting section: reloads its missing files (fetch) and then stores its votes (store) right away
module Section
  def self.handle state, city, zone, section
    puts "#{state}/#{city.nm}/#{zone}/#{section}"
    info = Ballot.info(state, city.cd, zone, section, fetch: FETCH) or return
    Hashie::Mash.new(JSON.parse info.data).hashes.peach do |hash|
      id    = [state, city.cd, zone, section, hash[:hash]]
      files = fetch id, hash
      store files, id, city.nm if STORE && files.none?(&:nil?) && !Stored.done?(*id)
    end
  end

  # with PHASE=store only the cached files are read, and the missing ones come back as nil
  def self.fetch id, hash
    (ENV['RDV_SKIP'] ? %w[log] : %w[log rdv]).map{ |type| Ballot.file(*id, Ballot.file_name(hash, type), fetch: FETCH) }
  end

  # everything is read before the database is touched, and written in one transaction, so a resume never finds half a section
  def self.store files, id, city
    state, _, zone, section = id
    log, rdv = files
    params   = Hashie::Mash.new state: state, city: city, zone: zone, section: section
    times    = VotingLog.rows log, params # sets the model, which the votes carry
    votes    = rdv ? Votes.rows(rdv, params) : []
    DB.transaction do
      DB[:voting_times].insert_conflict.multi_insert times
      DB[VOTES_TABLE].insert_conflict.multi_insert votes
    end
    Stored.mark(*id)
  end
end
