// Loads the shippable dump (data/manifest.json + gzip CSV parts) into the engine on demand, tracking what is loaded.
import { reactive } from 'vue'
import { load, many, one, query } from './db'
import { VIEWS } from './model'

const BASE = import.meta.env.BASE_URL
export const store = reactive({ manifest: null, loaded: {}, progress: {}, error: null })
const inflight = new Map()

const manifestTables = (m) => ({
  ...Object.assign({}, ...Object.values(m.elections).map((e) => e.tables)),
  cands: { ...m.cands, parts: { all: m.cands } },
})
export const tables = () => manifestTables(store.manifest)
export const parts = (table) => Object.keys(tables()[table].parts)
export const isLoaded = (table, part) => `${table}/${part}` in store.loaded
export const loadedParts = (table) => parts(table).filter((p) => isLoaded(table, p))

async function resetIfStale(version) {
  const stored = (await one(`select v from _meta where k='version'`))?.v
  if (stored === version) return
  for (const t of Object.keys(tables())) await query(`truncate ${t}`)
  await query('truncate _parts')
  await query(`delete from _meta`)
  await query(`insert into _meta values ('version', $1)`, [version])
}

/** The app mounts only after this resolves, so views can read the manifest synchronously. */
export const manifestReady = fetch(`${BASE}data/manifest.json`).then(async (res) => {
  if (!res.ok) throw new Error(`manifest.json: HTTP ${res.status}`)
  store.manifest = await res.json()
})

async function init() {
  await manifestReady
  await query('create table if not exists _parts(tbl text, part text, rows int, primary key (tbl, part))')
  await query('create table if not exists _meta(k text primary key, v text)')
  for (const t of Object.values(tables())) await query(t.ddl.replace('create table', 'create table if not exists'))
  await query('create index if not exists cands_ix on cands (election, office, uf, n)')
  await resetIfStale(store.manifest.version)
  for (const v of VIEWS) await query(v)
  for (const p of await many('select tbl, part, rows from _parts')) store.loaded[`${p.tbl}/${p.part}`] = p.rows
}

export const ready = init().catch((e) => { store.error = e.message })

async function loadPart(table, part) {
  const key = `${table}/${part}`
  const def = tables()[table]
  const p = def.parts[part]
  store.progress[key] = 0
  try {
    // a part interrupted before its _parts row was written is simply replaced
    await query(part === 'all' ? `truncate ${table}` : `delete from ${table} where ${p.where ?? `state = '${part}'`}`)
    await load(`copy ${table} (${def.columns}) from '/dev/blob' csv`, `${BASE}data/${p.url}`, store.manifest.version, p.bytes, (n, total) => (store.progress[key] = Math.min(n / total, 1)))
    await query(`analyze ${table}`) // no autovacuum in the browser: without statistics the planner picks nested loops for the cands joins
    await query('insert into _parts values ($1, $2, $3)', [table, part, p.rows])
    store.loaded[key] = p.rows
  } finally {
    delete store.progress[key]
  }
}

/** Resolves when the given parts of `table` (all of them when omitted) are in the engine; concurrent calls share the work. */
export async function ensure(table, wanted) {
  await ready
  const todo = (wanted ?? parts(table)).filter((p) => !isLoaded(table, p) && p in tables()[table].parts)
  await Promise.all(todo.map((p) => inflight.get(`${table}/${p}`) ?? track(table, p)))
}

const track = (table, part) => {
  const key = `${table}/${part}`
  const p = loadPart(table, part).finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}

/** Forgets every imported part (tables, bookkeeping and the cached downloads) and restarts. */
export async function clearLocal() {
  for (const t of Object.keys(tables())) await query(`truncate ${t}`)
  await query('truncate _parts')
  await caches.delete('auditoria-assets-v1')
  location.reload()
}

export const partBytes = (table, wanted) => (wanted ?? parts(table)).reduce((n, p) => n + (tables()[table].parts[p]?.bytes ?? 0), 0)

const DEFAULT_BUDGET = 8e6
const partDef = (table, key) => tables()[table].parts[key]
/** Parts holding the president (the only office of 2022); the deputy offices of 2026 are separate parts. */
const hasOffice = (table, key, office) => !partDef(table, key).offices || partDef(table, key).offices.includes(office)

/** Loads what views use by default: the whole table when small, else the smallest parts up to a compressed-bytes budget. */
export function ensureDefault(table) {
  let used = 0
  const small = parts(table).filter((k) => hasOffice(table, k, 1)).sort((a, b) => partBytes(table, [a]) - partBytes(table, [b])).filter((k) => (used += partBytes(table, [k])) <= DEFAULT_BUDGET)
  return ensure(table, small)
}

/** The parts of a state holding `office`, or the default set when no state is selected. */
export const ensureScope = (table, state, office = 1) =>
  state ? ensure(table, parts(table).filter((k) => k.split('.')[0] === state && hasOffice(table, k, office))) : ensureDefault(table)

/** Every part of a state (all offices), e.g. for one section's full ballot. */
export const ensureState = (table, state) => ensure(table, parts(table).filter((k) => k.split('.')[0] === state))
