# The TSE open data CSVs (CC BY) of a general election, downloaded once into RAW_DIR and imported with COPY. The voting
# machine files (RDV, logs) are not collected here: 2018 has none published and 2022 has them in huge per-state packages.
YEAR     = ENV['YEAR'] || '2018'
DATA_DIR = YEAR
RAW_DIR  = "#{DATA_DIR}/raw"
DB_NAME  = ENV['DB_NAME'] || "brazil-audit-#{YEAR}"

# CD_ELEICAO of the general election: the federal one (president) in the 1st and 2nd round, then the state ones (governor,
# senator, deputies), also in both rounds. The files have other elections too (supplementary, plebiscites): not imported.
ELECTIONS = { '2018' => %w[295 296 297 298], '2022' => %w[544 545 546 547] }.fetch YEAR

# The voting machine files (RDV and logs), only collected for 2022. The first round comes from the arqurnatot packages of the
# CDN, in RDVLOG_DIR; the second from the files of the portal collector (branch 2022), already published in its release.
RDVLOG_DIR = "#{DATA_DIR}/rdvlog"
MACHINE    = {
  '2022' => { url:    'https://cdn.tse.jus.br/estatistica/sead/eleicoes/eleicoes2022/arqurnatot/bu_imgbu_logjez_rdv_vscmr_2022_%{round}_%{uf}.zip',
              legacy: '/srv/auditoria/files',
              rounds: { 'o00406' => 1, 'o00407' => 2 },                # the election code in the names of the files
              days:   { 1 => '2022-10-02', 2 => '2022-10-30' } }       # a log also has the events of the other round and of the tests
}[YEAR]

# never more than 3 downloads nor 3 imports at once, however high WORKERS is
WORKERS  = (ENV['WORKERS'] || 3).to_i.clamp(1, 3)

# fetch the raw zips and then import them (and, with machine files, fetch their first round and import them), unless
# PHASE picks only one
PHASES   = ENV['PHASE'] ? [ENV['PHASE']] : %w[fetch import] + (MACHINE ? %w[rdvlog machine] : [])

# key of a section; every table is keyed by it (plus the turn and whatever else makes the row unique)
BASE_FIELDS = %i[state city city_code zone section]
