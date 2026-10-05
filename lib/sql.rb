# Pieces of SQL shared by the targets: the CSVs come into the staging tables as text, with #NULO# for no value
module Sql
  # the section columns of the staging tables of the votes, detail and urn files, as the tables store them
  SECTION    = "lower(sg_uf), nm_municipio, lpad(cd_municipio, 5, '0'), lpad(nr_zona, 4, '0'), lpad(nr_secao, 4, '0')"
  SECTION_BY = 'sg_uf, nm_municipio, cd_municipio, nr_zona, nr_secao'

  # what the targets without votes to check log in `imports`
  NO_TOTALS = 'NULL::bigint AS votes, NULL::int AS unclassified'

  def self.null(col) = "nullif(#{col}, '#NULO#')"

  # the TSE writes day/month/year, in the local time of the section
  def self.time(col) = "to_timestamp(#{null col}, 'DD/MM/YYYY HH24:MI:SS')::timestamp"
end
