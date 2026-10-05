# Reads the votes of a section from its RDV, as the rows of VOTES_TABLE
#   offices: 1 president, 3 governor, 5 senator, 6 federal deputy, 7 state deputy, 8 district deputy
#   kinds:   2 nominal, 3 blank (no number) and 4 invalid number, as seen in the files; 1 and 7 are stored as they come
module Votes
  def self.rows rdv, params
    votes = Rdv.votes rdv.data
    LEGACY ? legacy_rows(votes, params) : votes.map{ |office, kinds| params.merge office:, votes: Sequel.pg_jsonb(kinds) }
  end

  def self.legacy_rows votes, params
    nominal = votes.fetch(1).fetch(2, {})
    [params.merge(votes_13: nominal.fetch('13', 0), votes_22: nominal.fetch('22', 0))]
  end
end
