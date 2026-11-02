// How the voters were identified at the urn, from the urn logs: by fingerprint (bio), released by hand after the fingerprint failed or was not tried (man)
// or identified by the title number (nor). Zone rollups (sgz) answer from the country down to the zone and the sections (sg) below it.
import { LEVELS, levelOf } from './shift.js'
export { LEVELS, levelOf }

const SUMS = 'coalesce(sum(bio), 0)::bigint bio, coalesce(sum(man), 0)::bigint man, coalesce(sum(nor), 0)::bigint nor'

/** The children of the place in `args` ([], [uf], [uf, city], [uf, city, zone]), one row per child with its identifications. */
export function childrenSql(args, year, turn) {
  const [state, city, zone] = args
  const at = [state, city, zone].filter(Boolean)
  const where = ['state', 'city', 'zone'].slice(0, at.length).map((c, i) => ` and ${c} = $${i + 3}`).join('')
  const [table, key] = zone ? ['sg', 'section'] : ['sgz', ['state', 'city', 'zone'][at.length]]
  return { sql: `select ${key} k, ${SUMS} from ${table} where election = $1 and turn = $2 ${where} group by ${key}`, params: [year, turn, ...at] }
}

/** The sections of a state with the largest share of voters identified without the fingerprint, among those with at least `min` identifications. */
export const lowestSql = (year, turn, state, min, limit = 50) => ({
  sql: `select city, zone, section, bio::bigint bio, man::bigint man, nor::bigint nor from sg
    where election = $1 and turn = $2 and state = $3 and bio + man + nor >= $4 order by (man + nor)::float / (bio + man + nor) desc, city, zone, section limit ${+limit}`,
  params: [year, turn, state, min],
})

/** The shares of the three ways of identification, nothing when nobody was identified. */
export function sharesOf(r) {
  const total = Number(r.bio) + Number(r.man) + Number(r.nor)
  return { ...r, total, bioShare: total ? r.bio / total : null, manShare: total ? r.man / total : null, norShare: total ? r.nor / total : null, noFpShare: total ? (Number(r.man) + Number(r.nor)) / total : null }
}

export const totalOf = (rows) => sharesOf(rows.reduce((t, r) => ({ bio: t.bio + Number(r.bio), man: t.man + Number(r.man), nor: t.nor + Number(r.nor) }), { bio: 0, man: 0, nor: 0 }))
