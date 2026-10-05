# Tables are created on the first run. The ones of a section are keyed by it (state, city_code, zone, section) plus
# the turn and whatever else makes the row unique; states are lowercase, zones and sections zero padded to 4 digits.
module Schema
  def self.setup
    section(:rdv_votes, %i[turn office]){ smallint :turn; smallint :office; jsonb :votes } # { kind => { number => votes } }
    section(:section_detail, %i[turn office]) do
      smallint :turn; smallint :office
      Integer :eligible; Integer :turnout; Integer :abstention
      Integer :nominal_votes; Integer :blank_votes; Integer :null_votes; Integer :legend_votes; Integer :annulled_votes
      Integer :place_code; String :place; String :address; Time :received_at; Time :first_totalized_at
    end
    section(:section_urn, %i[turn]) do
      smallint :turn; bigint :votes
      String :urn; String :urn_type; String :flashcard; String :load_1; String :load_2; Time :loaded_at
      String :aggregated; Integer :place_code; Time :opened_at; Time :closed_at; Integer :biometric_voters
    end
    section(:urn_match, %i[turn]) do
      smallint :turn
      String :expected_urn; String :urn; Time :expected_loaded_at; Time :loaded_at
      String :origin; String :origin_desc; String :divergence
    end
    create(:candidates, %i[sq_candidato turn]) do
      bigint :sq_candidato; smallint :turn; String :state; smallint :office; String :office_name
      String :number; String :name; String :ballot_name
      Integer :party_number; String :party; String :party_name
      bigint :coalition_id; String :coalition; String :coalition_parties
      smallint :status_code; String :status; smallint :outcome_code; String :outcome
      String :gender; String :race; String :education; String :occupation
    end
    create(:elected, %i[sq_candidato turn]) do
      bigint :sq_candidato; smallint :turn; String :state; smallint :office; String :number; String :name
      Integer :party_number; String :party; String :coalition; String :status; smallint :outcome_code; String :outcome
      bigint :votes; bigint :valid_votes
    end
    create(:imports, %i[name]){ String :name; Integer :rows; Integer :loaded; bigint :votes; Integer :unclassified; Integer :skipped; Time :at }
    machine if MACHINE
  end

  # the voting machine files (RDV and logs), as in the 2026 collector with a turn: the votes by section and office, and a voting
  # time for each confirmed vote (more than one in the same second are kept). `machine_sections` says what each section had.
  def self.machine
    section(:rdv_machine, %i[turn office]){ String :model; smallint :turn; smallint :office; jsonb :votes }
    section(:voting_times, %i[turn], unique: false){ String :model; smallint :turn; String :post; Time :time }
    section(:machine_sections, %i[turn]) do
      smallint :turn; String :model; Integer :rdvs; Integer :logs; Integer :ballots; Integer :events; Integer :other_days; Integer :garbled
      Time :first_vote; Time :last_vote
    end
  end

  def self.section name, key, unique: true, &columns
    create name, %i[state city_code zone section] + key, unique: do
      BASE_FIELDS.each{ |f| String f }
      instance_eval(&columns)
    end
  end

  def self.create name, key, unique: true, &columns
    return if name.in? DB.tables

    DB.create_table name do
      instance_eval(&columns)
      index key, unique:
    end
  end
end
