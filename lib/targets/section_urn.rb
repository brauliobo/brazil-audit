module Targets
  # BWEB (boletim de urna): one row per votable of a section. A section that used more than one urn (a replacement, or
  # one voter moved to another urn) has a row per urn, with the votes recorded in it and its own opening and closing.
  # The votes of all the offices are summed to be checked against the ones of votacao_secao; cd_tipo_votavel is
  # 1 nominal, 2 blank, 3 null and 4 legend, anything else is unclassified.
  module SectionUrn
    TOTALS = <<~SQL.squish
      sum(qt_votos::bigint) FILTER (WHERE #{Sql::GENERAL})::bigint AS votes,
      count(*) FILTER (WHERE #{Sql::GENERAL} AND cd_tipo_votavel NOT IN ('1', '2', '3', '4')) AS unclassified, #{Sql::SKIPPED}
    SQL

    COLUMNS = %w[nr_urna_efetivada ds_tipo_urna cd_flascard_urna_efetivada cd_carga_1_urna_efetivada cd_carga_2_urna_efetivada
                 dt_carga_urna_efetivada ds_agregadas nr_local_votacao dt_abertura dt_encerramento qt_eleitores_biometria_nh]

    def self.insert(stg, _entry) = <<~SQL
      INSERT INTO section_urn (state, city, city_code, zone, section, turn, votes, urn, urn_type, flashcard, load_1, load_2,
                               loaded_at, aggregated, place_code, opened_at, closed_at, biometric_voters)
      SELECT #{Sql::SECTION}, nr_turno::smallint, sum(qt_votos::bigint), nr_urna_efetivada, ds_tipo_urna,
             cd_flascard_urna_efetivada, cd_carga_1_urna_efetivada, cd_carga_2_urna_efetivada,
             #{Sql.time 'dt_carga_urna_efetivada'}, ds_agregadas, nr_local_votacao::int, #{Sql.time 'dt_abertura'},
             #{Sql.time 'dt_encerramento'}, qt_eleitores_biometria_nh::int
      FROM #{stg} WHERE #{Sql::GENERAL} GROUP BY #{Sql::SECTION_BY}, nr_turno, #{COLUMNS.join ', '}
    SQL
  end
end
