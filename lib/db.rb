require 'pg'
require 'sequel'

# one process per state, each with a single connection, to stay far from the server's connection limit
DB = Sequel.connect adapter: 'postgres', database: DB_NAME, max_connections: 1, pool_timeout: 2.minutes.to_i
Sequel.extension :core_extensions
DB.extension :pg_json
