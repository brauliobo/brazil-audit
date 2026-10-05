# 2018 has no voting-machine files (RDV, logs, BU of the urns are not published): everything comes from the TSE open
# data CSVs (CC BY), downloaded once into RAW_DIR and imported with COPY
YEAR     = '2018'
DATA_DIR = YEAR
RAW_DIR  = "#{DATA_DIR}/raw"
DB_NAME  = ENV['DB_NAME'] || "brazil-audit-#{YEAR}"

# never more than 3 downloads nor 3 imports at once, however high WORKERS is
WORKERS  = (ENV['WORKERS'] || 3).to_i.clamp(1, 3)

# fetch the raw zips and then import them, unless PHASE picks only one
PHASES   = ENV['PHASE'] ? [ENV['PHASE']] : %w[fetch import]

# key of a section; every table is keyed by it (plus the turn and whatever else makes the row unique)
BASE_FIELDS = %i[state city city_code zone section]
