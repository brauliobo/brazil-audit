module Targets
  # votacao_candidato_munzona (votes per candidate, municipality and zone) summed per candidate and turn, with the outcome
  # (ELEITO, NÃO ELEITO, 2º TURNO, ...) the TSE gives each candidate
  module Elected
    TOTALS = 'sum(qt_votos_nominais::bigint)::bigint AS votes, NULL::int AS unclassified'

    BY = %w[sq_candidato nr_turno sg_uf cd_cargo nr_candidato nm_urna_candidato nr_partido sg_partido nm_coligacao
            ds_situacao_candidatura cd_sit_tot_turno ds_sit_tot_turno]

    def self.insert(stg, _entry) = <<~SQL
      INSERT INTO elected (sq_candidato, turn, state, office, number, name, party_number, party, coalition, status, outcome_code, outcome,
                           votes, valid_votes)
      SELECT sq_candidato::bigint, nr_turno::smallint, lower(sg_uf), cd_cargo::smallint, nr_candidato, nm_urna_candidato, nr_partido::int,
             sg_partido, #{Sql.null 'nm_coligacao'}, ds_situacao_candidatura, cd_sit_tot_turno::smallint, #{Sql.null 'ds_sit_tot_turno'},
             sum(qt_votos_nominais::bigint), sum(qt_votos_nominais_validos::bigint)
      FROM #{stg} GROUP BY #{BY.join ', '}
    SQL
  end
end
