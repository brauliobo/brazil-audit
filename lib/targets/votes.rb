module Targets
  # votacao_secao: one row per section, turn, office and votable. Rebuilt as the 2026 rdv_votes: { kind => { number => votes } }
  #   2 nominal (candidate number), 3 blank (95) and 4 null (96), both under the key '', 1 legend (party number) in the
  #   deputy offices, where only parties have 2 digit numbers, 5 votes annulled and counted apart (97, key '')
  # a row is unclassified when its number says nominal but its candidate (sq_candidato) is not one, or the other way round
  module Votes
    KIND = "CASE nr_votavel WHEN '95' THEN 3 WHEN '96' THEN 4 WHEN '97' THEN 5
            ELSE CASE WHEN cd_cargo IN ('6', '7', '8') AND length(nr_votavel) = 2 THEN 1 ELSE 2 END END"
    KEY  = "#{Sql::SECTION_BY}, nr_turno, cd_cargo"

    TOTALS = "sum(qt_votos::bigint)::bigint AS votes, count(*) FILTER (WHERE (#{KIND} = 2) <> (sq_candidato::bigint > 0)) AS unclassified"

    def self.insert(stg, _entry) = <<~SQL
      WITH typed AS (
        SELECT #{KEY}, #{KIND} AS kind, nr_votavel, qt_votos FROM #{stg}
      ), counted AS (
        SELECT #{KEY}, kind::text AS kind, CASE WHEN kind < 3 THEN nr_votavel ELSE '' END AS number, sum(qt_votos::bigint) AS votes
        FROM typed GROUP BY #{KEY}, kind, number
      ), numbered AS (
        SELECT #{KEY}, kind, jsonb_object_agg(number, votes) AS numbers FROM counted GROUP BY #{KEY}, kind
      )
      INSERT INTO rdv_votes (state, city, city_code, zone, section, turn, office, votes)
      SELECT #{Sql::SECTION}, nr_turno::smallint, cd_cargo::smallint, jsonb_object_agg(kind, numbers)
      FROM numbered GROUP BY #{KEY}
    SQL
  end
end
