require 'pg'
require 'sequel'

# one connection per worker, none of them with parallel query workers: nothing runs beyond WORKERS processes
SETTINGS = "SET synchronous_commit = off; SET work_mem = '256MB'; SET max_parallel_workers_per_gather = 0"

DB = Sequel.connect adapter: 'postgres', database: DB_NAME, max_connections: WORKERS, after_connect: proc{ |conn| conn.exec SETTINGS }
