// Loads the shippable dump (data/manifest.json + gzip CSV parts) into the shared schema on demand, tracking what is loaded.
// Part ids are `<election key>/<part>` for election tables (parts per UF, deputy offices apart) and `all` for cands and mun_map.
import { reactive } from 'vue'
import { load, many, one, query } from './db'
import { t } from './i18n'
import { INDEXES, VIEWS } from './model'

const BASE = import.meta.env.BASE_URL
export const store = reactive({ manifest: null, loaded: {}, progress: {}, error: null })
const inflight = new Map()

export const tables = () => store.manifest.tables
const partDef = (table, id) => tables()[table].parts[id]

/** Part ids of a table for an election (all of them for the election-free tables cands and mun_map). */
export const parts = (table, election) => Object.keys(tables()[table].parts).filter((id) => !election || id.startsWith(`${election}/`))
export const isLoaded = (table, id) => `${table}/${id}` in store.loaded
export const loadedParts = (table, election) => parts(table, election).filter((id) => isLoaded(table, id))
const stateOf = (id) => id.split('/')[1]?.split('.')[0]

/** The app mounts only after this resolves, so views can read the manifest synchronously. */
export const manifestReady = fetch(`${BASE}data/manifest.json`).then(async (res) => {
  if (!res.ok) throw new Error(t('errors.http', { url: 'manifest.json', status: res.status }))
  store.manifest = await res.json()
})

// a new dump (manifest version) replaces the whole schema, which also removes tables of older app versions
async function resetIfStale(version) {
  if ((await one(`select v from _meta where k='version'`))?.v === version) return
  await query('drop schema public cascade')
  await query('create schema public')
  await query('create table _meta(k text primary key, v text)')
  await query(`insert into _meta values ('version', $1)`, [version])
}

async function init() {
  await manifestReady
  await query('create table if not exists _meta(k text primary key, v text)')
  await resetIfStale(store.manifest.version)
  await query('create table if not exists _parts(tbl text, part text, rows int, primary key (tbl, part))')
  for (const t of Object.values(tables())) await query(t.ddl.replace('create table', 'create table if not exists'))
  for (const sql of [...INDEXES, ...VIEWS]) await query(sql)
  for (const p of await many('select tbl, part, rows from _parts')) store.loaded[`${p.tbl}/${p.part}`] = p.rows
}

export const ready = init().catch((e) => { store.error = e.message })

async function loadPart(table, id) {
  const key = `${table}/${id}`
  const def = tables()[table]
  const p = partDef(table, id)
  store.progress[key] = 0
  try {
    // a part interrupted before its _parts row was written is simply replaced
    await query(p.where ? `delete from ${table} where ${p.where}` : `truncate ${table}`)
    await load(`copy ${table} (${def.columns}) from '/dev/blob' csv`, `${BASE}data/${p.url}`, store.manifest.version, p.bytes, (n, total) => (store.progress[key] = Math.min(n / total, 1)))
    await query(`analyze ${table}`) // no autovacuum in the browser: without statistics the planner picks nested loops for the cands joins
    await query('insert into _parts values ($1, $2, $3)', [table, id, p.rows])
    store.loaded[key] = p.rows
  } finally {
    delete store.progress[key]
  }
}

const track = (table, id) => {
  const key = `${table}/${id}`
  const p = loadPart(table, id).finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}

/** Resolves when the given part ids of `table` are in the engine; concurrent calls share the work. */
export async function ensure(table, ids = parts(table)) {
  await ready
  await Promise.all(ids.filter((id) => !isLoaded(table, id)).map((id) => inflight.get(`${table}/${id}`) ?? track(table, id)))
}

/** The small tables of an election (rollups, coverage, residual...) whole; tables the election does not have are skipped. */
export const ensureSmall = (election, ...names) => Promise.all(names.map((t) => ensure(t, parts(t, election))))

/** Forgets every imported part (tables, bookkeeping and the cached downloads) and restarts. */
export async function clearLocal() {
  for (const t of Object.keys(tables())) await query(`truncate ${t}`)
  await query('truncate _parts')
  await caches.delete('auditoria-assets-v1')
  location.reload()
}

export const partBytes = (table, ids) => ids.reduce((n, id) => n + (partDef(table, id)?.bytes ?? 0), 0)

const DEFAULT_BUDGET = 8e6
/** Parts holding the president; the deputy offices of a collector election are separate parts. */
const hasOffice = (table, id, office) => !partDef(table, id).offices || partDef(table, id).offices.includes(office)

/** Loads what views use by default: the whole table when small, else the smallest president parts up to a compressed-bytes budget. */
export function ensureDefault(table, election) {
  let used = 0
  const small = parts(table, election).filter((id) => hasOffice(table, id, 1)).sort((a, b) => partBytes(table, [a]) - partBytes(table, [b])).filter((id) => (used += partBytes(table, [id])) <= DEFAULT_BUDGET)
  return ensure(table, small)
}

/** The parts of a state holding `office`, or the default set when no state is selected. */
export const ensureScope = (table, election, state, office = 1) =>
  state ? ensure(table, parts(table, election).filter((id) => stateOf(id) === state && hasOffice(table, id, office))) : ensureDefault(table, election)

/** Every part of a state (all offices), e.g. for one section's full ballot. */
export const ensureState = (table, election, state) => ensure(table, parts(table, election).filter((id) => stateOf(id) === state))

/** The UFs that have parts of a table for an election. */
export const statesIn = (table, election) => [...new Set(parts(table, election).map(stateOf))]
