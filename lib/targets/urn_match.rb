module Targets
  # CEFT (correspondência efetivada): the urn expected for each section and the one that was used; the file has no
  # turn column, it is in the name (ceft_1t_AC_...csv)
  module UrnMatch
    TOTALS = Sql::NO_TOTALS

    def self.insert(stg, entry) = <<~SQL
      INSERT INTO urn_match (state, city, city_code, zone, section, turn, expected_urn, urn, expected_loaded_at, loaded_at, origin,
                             origin_desc, divergence)
      SELECT #{Sql::SECTION}, #{entry[/_(\d)t_/, 1]}, nr_urna_esperada, nr_urna_efetivada, #{Sql.time 'dt_carga_urna_esperada'},
             #{Sql.time 'dt_carga_urna_efetivada'}, cd_origem_voto, ds_origem_voto, ds_divergencia
      FROM #{stg}
    SQL
  end
end
