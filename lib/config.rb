# 2022 (president, 2nd round) lives at the repo root and in the `brazil-audit` database, with its own votes table;
# other years get their own dir and database, and store the votes of every office
YEAR        = ENV['YEAR'] || '2026'
LEGACY      = YEAR == '2022'
CDP         = { '2022' => 407, '2024' => 452, '2026' => 3220 }.fetch YEAR
# election code of the official results (president file, which every city has); the site reads the same files
RESULTS     = { '2026' => 6257 }[YEAR]

DATA_DIR    = LEGACY ? '.' : YEAR
DB_NAME     = ENV['DB_NAME'] || (LEGACY ? 'brazil-audit' : "brazil-audit-#{YEAR}")
VOTES_TABLE = LEGACY ? :votes : :rdv_votes

SITE        = 'https://resultados.tse.jus.br/oficial'
BASE_URL    = "#{SITE}/ele#{YEAR}/arquivo-urna/#{CDP}"
PLEITO      = 'p%06d' % CDP

BASE_FIELDS = %i[state city zone section model]

# every section reloads its missing files (fetch) and then updates its votes (store), unless PHASE picks only one
PHASES      = ENV['PHASE'] ? [ENV['PHASE']] : %w[fetch store]
FETCH       = PHASES.include? 'fetch'
STORE       = PHASES.include? 'store'
STATES      = ENV['STATES']&.split || %w[
  AC AL AM AP BA CE DF ES GO MA
  MG MS MT PA PB PE PI
  PR RJ RN RO RR RS
  SC SE SP TO
  ZZ
].reverse
