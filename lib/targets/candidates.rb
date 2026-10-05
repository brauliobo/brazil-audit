module Targets
  # consulta_cand: the registry of candidates (the president is in the BR file, the other offices in the one of their state).
  # There are no federations in 2018. CPF, voter registration and e-mail are not kept.
  module Candidates
    TOTALS = Sql::NO_TOTALS

    def self.insert(stg, _entry) = <<~SQL
      INSERT INTO candidates (sq_candidato, state, office, office_name, number, name, ballot_name, party_number, party, party_name,
                              coalition_id, coalition, coalition_parties, status_code, status, outcome_code, outcome, gender, race,
                              education, occupation)
      SELECT sq_candidato::bigint, lower(sg_uf), cd_cargo::smallint, ds_cargo, nr_candidato, nm_candidato, nm_urna_candidato,
             nr_partido::int, sg_partido, nm_partido, sq_coligacao::bigint, #{Sql.null 'nm_coligacao'},
             #{Sql.null 'ds_composicao_coligacao'}, cd_situacao_candidatura::smallint, ds_situacao_candidatura,
             cd_sit_tot_turno::smallint, #{Sql.null 'ds_sit_tot_turno'}, ds_genero, ds_cor_raca, ds_grau_instrucao, ds_ocupacao
      FROM #{stg}
    SQL
  end
end
