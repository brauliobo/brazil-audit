// Seeded random numbers (mulberry32) and an exact binomial sampler, so every rebuild reproduces the same baseline.
import { lnGamma } from '../../src/benford/stats.js'

/** FNV-1a hash of a string, to derive one seed per series from a global seed. */
export function hash(text) {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return h >>> 0
}

export function mulberry32(seed) {
  let a = seed | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const TABLE = 20000
const lnFact = new Float64Array(TABLE + 1)
for (let i = 2; i <= TABLE; i++) lnFact[i] = lnFact[i - 1] + Math.log(i)
const lf = (n) => (n <= TABLE ? lnFact[n] : lnGamma(n + 1))

/** Above this variance the normal approximation (error far below the replicate noise) replaces the exact inversion. */
const NORMAL_VAR = 400

export const modeOf = (n, p) => Math.floor((n + 1) * p)
export const pmfAt = (n, k, p) => Math.exp(lf(n) - lf(k) - lf(n - k) + k * Math.log(p) + (n - k) * Math.log(1 - p))

/**
 * Exact inversion that walks outward from the mode (any fixed order of the outcomes is a valid inversion, and this one needs
 * about one standard deviation of steps). `pm` is the probability of the mode `m`; u in [0, 1).
 */
export function invert(n, p, m, pm, u) {
  if (u < pm) return m
  const odds = p / (1 - p)
  let [hi, lo, ph, pl, acc] = [m, m, pm, pm, pm]
  for (;;) {
    if (hi < n) { hi++; ph *= ((n - hi + 1) / hi) * odds; acc += ph; if (u < acc) return hi }
    if (lo > 0) { pl *= lo / (n - lo + 1) / odds; lo--; acc += pl; if (u < acc) return lo }
    if (hi >= n && lo <= 0) return m
  }
}

const normal = (rng) => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng())

/** One Binomial(n, p) draw. */
export function binomial(rng, n, p) {
  if (p <= 0 || n <= 0) return 0
  if (p >= 1) return n
  const var_ = n * p * (1 - p)
  if (var_ > NORMAL_VAR) return Math.min(n, Math.max(0, Math.round(n * p + Math.sqrt(var_) * normal(rng))))
  const m = modeOf(n, p)
  return invert(n, p, m, pmfAt(n, m, p), rng())
}

export const isExact = (n, p) => n * p * (1 - p) <= NORMAL_VAR
