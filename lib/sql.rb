# Pieces of SQL shared by the targets, which read the staging tables
module Sql
  # the section columns of the staging tables of the votes, detail and urn files, as the tables store them
  SECTION    = "lower(sg_uf), nm_municipio, lpad(cd_municipio, 5, '0'), lpad(nr_zona, 4, '0'), lpad(nr_secao, 4, '0')"
  SECTION_BY = 'sg_uf, nm_municipio, cd_municipio, nr_zona, nr_secao'

  # the 2018 files also have supplementary elections (Tocantins in June 2018, Mato Grosso senator in November 2020...),
  # with their own turns and offices: only the general election, of the two days below, is imported
  GENERAL = "dt_eleicao IN ('07/10/2018', '28/10/2018')"

  # what each target logs in `imports` besides the rows read: votes to check, unclassified rows and the ones skipped
  # because they are not of the general election
  NO_VOTES = 'NULL::bigint AS votes, NULL::int AS unclassified'
  SKIPPED  = "count(*) FILTER (WHERE NOT #{GENERAL}) AS skipped"

  # the TSE writes day/month/year, in the local time of the section
  def self.time(col) = "to_timestamp(#{col}, 'DD/MM/YYYY HH24:MI:SS')::timestamp"
end
