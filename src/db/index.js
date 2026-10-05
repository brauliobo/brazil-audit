// The only module that talks to the database engine (PGlite in a worker): query(sql, params) plus reactive status.
// Swapping the engine means reimplementing this file only.
import { reactive } from 'vue'
import { PGliteWorker } from '@electric-sql/pglite/worker'
import { cachedFetch, gunzip } from './fetching'

export const engine = reactive({ text: 'Iniciando o PGlite (baixa o WASM e roda o initdb)…', ready: false, error: null, queries: 0, persisted: false })

const DATA_DIR = 'idb://auditoria' // IndexedDB: the imported data survives reloads
const NUMERIC_OIDS = new Set([20, 21, 23, 700, 701, 1700]) // int8 int2 int4 float4 float8 numeric

const db = PGliteWorker.create(new Worker(new URL('./pglite.worker.js', import.meta.url), { type: 'module' }), { dataDir: DATA_DIR })
export const ready = db.then(() => Object.assign(engine, { ready: true, text: 'Pronto' }), (e) => { engine.error = String(e.message ?? e) })

export class SqlError extends Error {
  constructor({ message, detail, hint, position }, sql) { super(message); Object.assign(this, { detail, hint, position, sql }) }
}

const cell = (v, oid) =>
  v === null ? null
  : NUMERIC_OIDS.has(oid) ? Number(v)
  : v instanceof Date ? v.toISOString()
  : typeof v === 'object' ? JSON.stringify(v)
  : v

// one statement at a time, so `ms` is the statement's own time rather than its wait behind other panels' queries
let queue = Promise.resolve()
const exclusive = (fn) => {
  const result = queue.then(fn)
  queue = result.catch(() => {})
  return result
}

const run = (sql, params, options) => exclusive(async () => {
  await ready
  const t0 = performance.now()
  try {
    const r = await (await db).query(sql, params, { rowMode: 'array', ...options })
    engine.queries++
    return { columns: r.fields.map((f) => f.name), rows: r.rows.map((row) => row.map((v, i) => cell(v, r.fields[i].dataTypeID))), ms: performance.now() - t0 }
  } catch (e) {
    throw new SqlError(e, sql)
  }
})

/** @returns {Promise<{columns: string[], rows: any[][], ms: number}>} `params` are bound server-side as $1, $2, … */
export const query = (sql, params = []) => run(sql, params)

export const objects = ({ columns, rows }) => rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i]])))
export const many = async (sql, params) => objects(await query(sql, params))
export const one = async (sql, params) => (await many(sql, params))[0]

/** Imports a gzip CSV part with COPY ... FROM '/dev/blob'; the download is kept in the Cache API under `version`. */
export async function load(copySql, url, version, size, onProgress) {
  const res = await cachedFetch(url, version)
  const blob = await new Response(gunzip(res, (n) => onProgress(n, size))).blob()
  return run(copySql, [], { blob })
}

const literal = (v) =>
  v === null || v === undefined ? 'NULL'
  : typeof v === 'number' || typeof v === 'boolean' ? String(v)
  : `'${String(v).replaceAll("'", "''")}'`

/** The statement with its parameters spelled out, to display and to paste into the SQL console. */
export const inline = (sql, params = []) => sql.replace(/\$(\d+)/g, (_, i) => literal(params[i - 1]))
