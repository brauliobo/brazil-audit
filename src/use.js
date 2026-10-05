import { reactive, watch } from 'vue'
import { inline, query } from './db'

/**
 * Runs `run(deps, q)` whenever `deps()` changes (latest call wins). `q` is db.query that also records each SQL text and
 * its engine time, so panels can show what ran and how long it took.
 */
export function useAsync(deps, run) {
  const s = reactive({ data: null, error: null, loading: true, ms: 0, sqls: [] })
  let seq = 0
  watch(deps, async (d) => {
    const id = ++seq
    const sqls = []
    const q = async (sql, params) => {
      const r = await query(sql, params)
      sqls.push({ sql: inline(sql, params), ms: r.ms })
      return r
    }
    Object.assign(s, { loading: true, error: null })
    try {
      const data = await run(d, q)
      if (id === seq) Object.assign(s, { data, ms: sqls.reduce((t, x) => t + x.ms, 0), sqls })
    } catch (e) {
      if (id === seq) Object.assign(s, { error: e, data: null, sqls })
    } finally {
      if (id === seq) s.loading = false
    }
  }, { immediate: true, deep: true })
  return s
}

export const useQuery = (deps, build, map = (r) => r) => useAsync(deps, async (d, q) => map(await q(...build(d))))
