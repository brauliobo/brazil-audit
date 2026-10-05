// The no-manipulation baseline: every section (or municipality, or UF) draws its count for one series from a binomial with the
// real size and the share of the next level up (section: its municipality, municipality: its UF, UF: the country), then the
// digit histograms of each replicate are kept. One simulation yields every place at once: municipalities, UFs and the country
// are sums of the same draws.
import { DIGITS, chiSquare, expected, mad, quantile, total } from '../../src/benford/stats.js'
import { binomial, invert, isExact, modeOf, mulberry32, pmfAt } from './rng.mjs'

// Flat histogram of one replicate: first digit (9) | second digit (10) | first two digits (90) | last digit (10)
const AT = { d1: [0, 9], d2: [9, 10], d12: [19, 90], d_last: [109, 10] }
export const WIDTH = 119
const SHORT = 19 // municipalities keep d1 and d2 only

function add(h, o, v) {
  if (v <= 0) return
  h[o + 109 + (v % 10)]++
  if (v < 10) { h[o + v - 1]++; return }
  let t = v
  while (t >= 100) t = Math.floor(t / 10)
  h[o + 19 + t - 10]++
  h[o + 9 + (t % 10)]++
  h[o + Math.floor(t / 10) - 1]++
}

/** The first 19 cells of `add` (d1, d2) only. */
function addShort(h, o, v) {
  if (v <= 0) return
  if (v < 10) { h[o + v - 1]++; return }
  let t = v
  while (t >= 100) t = Math.floor(t / 10)
  h[o + 9 + (t % 10)]++
  h[o + Math.floor(t / 10) - 1]++
}

const sum = (h, width, reps, into) => { for (let r = 0; r < reps; r++) for (let k = 0; k < width; k++) into[r * width + k] += h[r * width + k] }
const proportions = (h, width, r, [at, len]) => {
  const counts = Array.from(h.subarray(r * width + at, r * width + at + len))
  return { counts, n: total(counts) }
}

/** Mean and 2.5% / 97.5% envelope of the replicates of `pos`: per digit (proportions), and of the MAD and chi-square. */
export function summarize(h, width, reps, pos) {
  const probs = expected(pos)
  const runs = Array.from({ length: reps }, (_, r) => proportions(h, width, r, AT[pos])).filter((x) => x.n > 0)
  if (!runs.length) return null
  const band = (values) => {
    const s = values.toSorted((a, b) => a - b)
    return { mean: s.reduce((t, v) => t + v, 0) / s.length, lo: quantile(s, 0.025), hi: quantile(s, 0.975) }
  }
  return {
    digits: DIGITS[pos].map((_, i) => band(runs.map((x) => x.counts[i] / x.n))),
    mad: band(runs.map((x) => mad(x.counts, probs))),
    chi2: band(runs.map((x) => chiSquare(x.counts, probs).chi2)),
  }
}

const POSITIONS = {
  section: { mun: ['d1', 'd2'], uf: Object.keys(AT), br: Object.keys(AT) },
  city: { uf: ['d1', 'd2', 'd_last'], br: ['d1', 'd2', 'd_last'] },
  uf: { br: ['d1', 'd2', 'd_last'] },
}
export const positionsOf = (unit, level) => POSITIONS[unit][level]

/**
 * Simulates one series.
 *   office  { size: Int32Array, munOf: Int32Array, muns: [{ uf, start, end }] } (sections sorted by municipality)
 *   votes   Int32Array of the observed votes per section (the municipality and UF shares come from these)
 *   levels  { ufs: [uf], national: bool, muns: Set of municipality indexes to keep }
 * Returns [{ unit, uf, city (municipality index or null), pos, ...summarize }] for every place of the series.
 */
export function simulate(office, votes, { ufs, national, muns: wanted }, { reps, seed }) {
  const rng = mulberry32(seed)
  const byUf = new Map(ufs.map((uf) => [uf, { sec: new Int32Array(reps * WIDTH), city: new Int32Array(reps * WIDTH), size: 0, votes: 0, muns: [] }]))
  office.muns.forEach((m, i) => byUf.get(m.uf)?.muns.push(i))
  const munHist = new Map()

  for (const [uf, u] of byUf) {
    for (const i of u.muns) {
      const { start, end } = office.muns[i]
      let [s, v] = [0, 0]
      for (let k = start; k < end; k++) { s += office.size[k]; v += votes[k] }
      Object.assign(u, { size: u.size + s, votes: u.votes + v })
      if (v > 0) simulateMunicipality(office, start, end, v / s, u.sec, wanted.has(i) ? munHist.set(i, new Int32Array(reps * SHORT)).get(i) : null, reps, rng)
    }
  }

  const out = []
  const push = (unit, uf, city, level, h, width) => {
    for (const pos of positionsOf(unit, level)) { const s = summarize(h, width, reps, pos); if (s) out.push({ unit, uf, city, pos, ...s }) }
  }
  for (const [i, h] of munHist) push('section', office.muns[i].uf, i, 'mun', h, SHORT)

  const [natSec, natCity, natUf] = [1, 2, 3].map(() => new Int32Array(reps * WIDTH))
  const real = [...byUf].filter(([uf]) => uf !== 'zz') // municipalities and UFs as units exclude the consular posts
  const natShare = real.reduce((t, [, u]) => t + u.votes, 0) / real.reduce((t, [, u]) => t + u.size, 0)
  for (const [uf, u] of byUf) {
    if (uf !== 'zz' && u.votes > 0) simulateCities(office, u, reps, rng)
    push('section', uf, null, 'uf', u.sec, WIDTH)
    sum(u.sec, WIDTH, reps, natSec)
    if (uf !== 'zz') { push('city', uf, null, 'uf', u.city, WIDTH); sum(u.city, WIDTH, reps, natCity) }
  }
  if (national) {
    push('section', 'br', null, 'br', natSec, WIDTH)
    push('city', 'br', null, 'br', natCity, WIDTH)
    for (let r = 0; r < reps; r++) for (const [, u] of real) add(natUf, r * WIDTH, binomial(rng, u.size, natShare))
    push('uf', 'br', null, 'br', natUf, WIDTH)
  }
  return out
}

/** Sections of one municipality: Binomial(section size, municipality share), `reps` times each. */
function simulateMunicipality(office, start, end, p, hUf, hMun, reps, rng) {
  for (let k = start; k < end; k++) {
    const n = office.size[k]
    if (n <= 0) continue
    const exact = p < 1 && isExact(n, p)
    const m = exact ? modeOf(n, p) : 0
    const pm = exact ? pmfAt(n, m, p) : 0
    for (let r = 0; r < reps; r++) {
      const v = p >= 1 ? n : exact ? invert(n, p, m, pm, rng()) : binomial(rng, n, p)
      add(hUf, r * WIDTH, v)
      if (hMun) addShort(hMun, r * SHORT, v)
    }
  }
}

/** Municipalities of a UF as units: Binomial(municipality size, UF share). */
function simulateCities(office, u, reps, rng) {
  const p = u.votes / u.size
  for (const i of u.muns) {
    const { start, end } = office.muns[i]
    let n = 0
    for (let k = start; k < end; k++) n += office.size[k]
    for (let r = 0; r < reps; r++) add(u.city, r * WIDTH, binomial(rng, n, p))
  }
}
