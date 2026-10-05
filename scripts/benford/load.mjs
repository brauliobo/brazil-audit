// Reads one election/office from the scratch database into typed arrays for the simulation.
import { parseCsvLine } from '../csv.mjs'
import { stream } from './psql.mjs'
import { SCRATCH } from './scratch.mjs'

/** Sections in id order (state, city, zone, section), so every municipality is one contiguous run. */
export async function loadOffice({ year, turn }, office) {
  const [size, muns] = [[], []]
  await stream(SCRATCH, `select uf, city, size from sec where election = ${year} and turn = ${turn} and office = ${office} order by id`, (line) => {
    const [uf, city, n] = parseCsvLine(line)
    const last = muns.at(-1)
    if (last?.uf === uf && last.city === city) last.end++
    else muns.push({ uf, city, start: size.length, end: size.length + 1 })
    size.push(+n)
  })
  const munOf = new Int32Array(size.length)
  muns.forEach((m, i) => munOf.fill(i, m.start, m.end))
  return { n: size.length, size: Int32Array.from(size), muns, munOf }
}

/** Votes of the wanted candidates: Map cand -> { ids, votes } (sparse, only sections with votes). */
export async function loadFacts({ year, turn }, office, wanted) {
  const facts = new Map([...wanted].map((c) => [c, { ids: [], votes: [] }]))
  await stream(SCRATCH, `select id, cand, votes from fact where election = ${year} and turn = ${turn} and office = ${office}`, (line) => {
    const [id, cand, votes] = line.split(',')
    const f = facts.get(cand)
    if (f) { f.ids.push(+id - 1); f.votes.push(+votes) }
  })
  return facts
}

/** The votes of one candidate as a dense array over the sections of the office. */
export function dense(office, { ids, votes }) {
  const out = new Int32Array(office.n)
  ids.forEach((id, i) => (out[id] = votes[i]))
  return out
}
