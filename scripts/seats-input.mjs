// The calculation inputs and the official result of an election, read from the shipped dump (data/): the same rows the app loads into
// PGlite, so the unit tests and scripts/verify-seats.mjs exercise the real data. `residual` adds the official residual (sections the dump lacks).
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { ELECTIONS } from '../src/elections.js'
import { parseCsvLine } from './csv.mjs'

const DEPUTIES = [6, 7, 8]
const rowsOf = (table, key) => gunzipSync(readFileSync(`data/${table}/${key}.csv.gz`)).toString().split('\n').filter(Boolean).map(parseCsvLine)
const at = (uf, office) => `${uf}/${office}`
const push = (map, key, value) => map.set(key, [...(map.get(key) ?? []), value])
const add = (map, key, n) => map.set(key, (map.get(key) ?? 0) + n)

/** Votes per UF/office/candidate: res (+ residual), deputy offices only. */
function votesOf(key, residual) {
  const totals = new Map()
  for (const [, , uf, , office, n, votes] of rowsOf('res', key)) if (DEPUTIES.includes(+office)) add(totals, `${at(uf, +office)}/${n}`, +votes)
  if (residual) {
    for (const [, , uf, , , , office, n, votes] of rowsOf('residual', key)) if (DEPUTIES.includes(+office) && n !== 'branco' && n !== 'nulo') add(totals, `${at(uf, +office)}/${n}`, +votes)
  }
  const byOffice = new Map()
  for (const [k, votes] of totals) push(byOffice, k.slice(0, k.lastIndexOf('/')), { n: k.slice(k.lastIndexOf('/') + 1), votes })
  return byOffice
}

/** { inputs: Map("uf/office" -> calculation input), official: Map("uf/office" -> [{ n, status }]) } of an election key (e.g. '2022'). */
export function loadElection(key, { residual = true } = {}) {
  residual &&= ELECTIONS[key].hasResidual
  const [votes, seats, annulled, official] = [votesOf(key, residual), new Map(), new Map(), new Map()]
  for (const [, , uf, office, , n] of rowsOf('seats', key)) add(seats, at(uf, +office), +n)
  for (const [, , uf, office, n] of rowsOf('annulled', key)) push(annulled, at(uf, +office), n)
  for (const [, , uf, office, n, , , status] of rowsOf('elected', key)) if (DEPUTIES.includes(+office)) push(official, at(uf, +office), { n, status })
  const lineups = new Map()
  const officialVotes = new Map()
  for (const [, , uf, office, party, sigla, bloc, name, valid, legend, extra, total] of rowsOf('lineup', key)) {
    push(lineups, at(uf, +office), { party, sigla, bloc, name, valid: valid === 'true', legend: +legend + (residual ? +extra : 0) })
    add(officialVotes, at(uf, +office), +total)
  }
  const inputs = new Map([...lineups].map(([k, lineup]) => [k, { seats: seats.get(k), lineup, votes: votes.get(k) ?? [], annulled: annulled.get(k) ?? [], officialVotes: officialVotes.get(k) }]))
  return { inputs, official }
}
