// The observed digit histograms, in SQL on the scratch facts. For every shipped series (see plan.mjs):
//   section unit   votes of each section, in the UF place, the national place and (series with `mun`) municipality places
//   city unit      candidate votes of each municipality, in UF and national places        (big series; consular posts excluded)
//   uf unit        candidate votes of each UF, national place                              (big series; consular posts excluded)
// Digits: first = left(v,1); second = substr(v,2,1) and first two = left(v,2) only for v >= 10; last = v % 10. Zeros have no digit.
import { DIGITS, minSample, total } from '../../src/benford/stats.js'
import { munSections } from './plan.mjs'
import { psql, rows } from './psql.mjs'
import { SCRATCH } from './scratch.mjs'

const EXPR = {
  d1: (v) => `left(${v}::text, 1)::int`,
  d2: (v) => `case when ${v} >= 10 then substr(${v}::text, 2, 1)::int end`,
  d12: (v, big) => `case when ${v} >= 10 and ${big} then left(${v}::text, 2)::int end`,
  d_last: (v) => `${v} % 10`,
}
const digitsOf = (positions, v, big = 'true') => `cross join lateral (values ${positions.map((p) => `('${p}', ${EXPR[p](v, big)})`).join(', ')}) d(pos, digit)`
const ALL = ['d1', 'd2', 'd12', 'd_last']
const SHORT = ['d1', 'd2', 'd_last']

/** One statement, all places of one election turn/office; columns: unit, uf, city, cand, pos, digit, n. */
export function histSql({ year, turn }, office) {
  const [E, T, O] = [year, turn, office]
  const ser = `ser.election = ${E} and ser.turn = ${T} and ser.office = ${O}`
  const agg = (unit, uf, city, cand, from) => `select '${unit}', ${uf}, ${city}, ${cand}, d.pos, d.digit, count(*) from ${from} where d.digit is not null group by 1, 2, 3, 4, 5, 6`
  return `with v as materialized (select s.uf, s.city, f.cand, f.votes v from fact f join sec s on s.election = f.election and s.turn = f.turn and s.office = f.office and s.id = f.id
      where f.election = ${E} and f.turn = ${T} and f.office = ${O} and f.cand in (select cand from ser where election = ${E} and turn = ${T} and office = ${O})),
    bigm as (select uf, city from sec where election = ${E} and turn = ${T} and office = ${O} and uf <> 'zz' group by 1, 2 having count(*) >= ${munSections(O)}),
    c as (select uf, city, cand, sum(v) v from v where uf <> 'zz' group by 1, 2, 3 having sum(v) > 0),
    u as (select uf, cand, sum(v) v from c group by 1, 2)
    ${agg('section', 'v.uf', 'null::text', 'v.cand', `v join ser on ${ser} and ser.uf = v.uf and ser.cand = v.cand ${digitsOf(ALL, 'v.v', 'ser.d12')}`)}
    union all ${agg('section', `'br'`, 'null::text', 'v.cand', `v join ser on ${ser} and ser.uf = 'br' and ser.cand = v.cand ${digitsOf(ALL, 'v.v', 'ser.d12')}`)}
    union all ${agg('section', 'v.uf', 'v.city', 'v.cand', `v join bigm using (uf, city) join ser on ${ser} and ser.mun and ser.uf in ('br', v.uf) and ser.cand = v.cand ${digitsOf(['d1', 'd2'], 'v.v')}`)}
    union all ${agg('city', 'c.uf', 'null::text', 'c.cand', `c join ser on ${ser} and ser.big and ser.uf = c.uf and ser.cand = c.cand ${digitsOf(SHORT, 'c.v')}`)}
    union all ${agg('city', `'br'`, 'null::text', 'c.cand', `c join ser on ${ser} and ser.big and ser.uf = 'br' and ser.cand = c.cand ${digitsOf(SHORT, 'c.v')}`)}
    union all ${agg('uf', `'br'`, 'null::text', 'u.cand', `u join ser on ${ser} and ser.big and ser.uf = 'br' and ser.cand = u.cand ${digitsOf(SHORT, 'u.v')}`)}`
}

/** Replaces the series of an election/office in the scratch database. */
export const storeSeries = ({ year, turn }, office, series) => psql(SCRATCH, `create table if not exists ser (election int, turn int, office int, uf text, cand text, big bool, d12 bool, mun bool);
  delete from ser where election = ${year} and turn = ${turn} and office = ${office};
  insert into ser values ${series.map((s) => `(${year}, ${turn}, ${office}, '${s.uf}', '${s.cand}', ${s.big}, ${s.d12}, ${s.mun})`).join(', ')};`)

/** Scope records { unit, uf, city, cand, pos, counts } with every digit present (zero counts filled in); thin d12 scopes dropped. */
export async function observed(el, office) {
  const scopes = new Map()
  for (const [unit, uf, city, cand, pos, digit, n] of await rows(SCRATCH, histSql(el, office))) {
    const key = [unit, uf, city, cand, pos].join('\t')
    const s = scopes.get(key) ?? { unit, uf, city: city || null, cand, pos, counts: Array(DIGITS[pos].length).fill(0) }
    s.counts[+digit - DIGITS[pos][0]] = +n
    scopes.set(key, s)
  }
  return [...scopes.values()].filter((s) => s.pos !== 'd12' || total(s.counts) >= minSample('d12'))
}
