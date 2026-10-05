module Targets
  # consulta_cand: the registry of candidates (the president is in the BR file, the other offices in the one of their
  # state). The ones of a second round are in both turns, each with its outcome.
  # There are no federations in 2018. CPF, voter registration and e-mail are not kept.
  module Candidates
    TOTALS = "#{Sql::NO_VOTES}, #{Sql::SKIPPED}"

    def self.insert(stg, _entry) = <<~SQL
      INSERT INTO candidates (sq_candidato, turn, state, office, office_name, number, name, ballot_name, party_number,
                              party, party_name, coalition_id, coalition, coalition_parties, status_code, status,
                              outcome_code, outcome, gender, race, education, occupation)
      SELECT sq_candidato::bigint, nr_turno::smallint, lower(sg_uf), cd_cargo::smallint, ds_cargo, nr_candidato,
             nm_candidato, nm_urna_candidato, nr_partido::int, sg_partido, nm_partido, sq_coligacao::bigint,
             nm_coligacao, ds_composicao_coligacao, cd_situacao_candidatura::smallint, ds_situacao_candidatura,
             cd_sit_tot_turno::smallint, ds_sit_tot_turno, ds_genero, ds_cor_raca, ds_grau_instrucao, ds_ocupacao
      FROM #{stg} WHERE #{Sql::GENERAL}
    SQL
  end
end
