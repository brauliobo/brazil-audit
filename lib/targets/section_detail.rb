module Targets
  # detalhe_votacao_secao: turnout and kinds of votes per section, turn and office, with the polling place.
  # The columns ds_origem_voto, st_secao_instalada, st_secao_anulada and cd_modelo_urna are empty in 2018 (#NULO#, -1).
  module SectionDetail
    TOTALS = Sql::NO_TOTALS

    def self.insert(stg, _entry) = <<~SQL
      INSERT INTO section_detail (state, city, city_code, zone, section, turn, office, eligible, turnout, abstention, nominal_votes,
                                  blank_votes, null_votes, legend_votes, annulled_votes, place_code, place, address, received_at,
                                  first_totalized_at)
      SELECT #{Sql::SECTION}, nr_turno::smallint, cd_cargo::smallint, qt_aptos::int, qt_comparecimento::int, qt_abstencoes::int,
             qt_votos_nominais::int, qt_votos_brancos::int, qt_votos_nulos::int, qt_votos_legenda::int, qt_votos_anulados_apu_sep::int,
             nr_local_votacao::int, nm_local_votacao, ds_local_votacao_endereco, #{Sql.time 'dt_recebimento_bu_hor_tse'},
             #{Sql.time 'dt_prim_tot_parcial_hor_tse'}
      FROM #{stg}
    SQL
  end
end
