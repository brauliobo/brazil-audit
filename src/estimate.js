// Estimates how the voters of each first-round group (a candidate, blank and null, abstention) voted in the runoff, from how the places differ.
// Each place i gives x_i (the first-round groups) and y_i (the runoff: a, b, blank and null, abstention); the model is y_i ≈ x_i T with every row of T
// a distribution (non-negative, sums to 1), fitted by weighted least squares (weight 1/size, so large places do not decide alone).
// This is ecological inference: it estimates average behaviour from places, never a person's vote, and groups that look alike across places are not
// told apart. A bootstrap over the places gives the range of each share, widened by other penalty strengths and by the estimate that compares only places of the same group.
const mulberry32 = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/** Euclidean projection of a vector onto the simplex (non-negative, sums to 1). */
export function simplex(v) {
  const u = [...v].sort((a, b) => b - a)
  let sum = 0, theta = 0
  u.forEach((x, i) => { sum += x; if (x - (sum - 1) / (i + 1) > 0) theta = (sum - 1) / (i + 1) })
  return v.map((x) => Math.max(x - theta, 0))
}

const zeros = (n, m) => Array.from({ length: n }, () => Array(m).fill(0))

/**
 * The units as shares of their size, with weight `w` (their size). With `centered`, the average of their `group` (the state of a municipality, the zone of a
 * section) is taken out, so only how a place differs from the others of its group is used: what a whole region has in common (which candidates were strong
 * there, how it voted) is then not mistaken for how the voters of a candidate voted. The totals of the groups are lost with it.
 */
function shares(units, centered) {
  const size = (u) => Math.max(u.y.reduce((n, v) => n + v, 0), 1)
  const mean = new Map()
  if (centered) {
    for (const u of units) {
      const m = mean.get(u.group) ?? { w: 0, x: u.x.map(() => 0), y: u.y.map(() => 0) }
      m.w += size(u)
      u.x.forEach((v, i) => { m.x[i] += v })
      u.y.forEach((v, j) => { m.y[j] += v })
      mean.set(u.group, m)
    }
  }
  return units.map((u) => {
    const [w, m] = [size(u), mean.get(u.group)]
    return { w, x: u.x.map((v, i) => v / w - (m ? m.x[i] / m.w : 0)), y: u.y.map((v, j) => v / w - (m ? m.y[j] / m.w : 0)) }
  })
}

function moments(shares, pick) {
  const [p, d] = [shares[0].x.length, shares[0].y.length]
  const [G, H] = [zeros(p, p), zeros(p, d)]
  for (const k of pick) {
    const { x, y, w } = shares[k]
    for (let i = 0; i < p; i++) {
      for (let j = 0; j < p; j++) G[i][j] += w * x[i] * x[j]
      for (let j = 0; j < d; j++) H[i][j] += w * x[i] * y[j]
    }
  }
  return { G, H }
}

const top = (G) => { // largest eigenvalue of a symmetric matrix, by power iteration
  let v = G.map(() => 1), l = 0
  for (let i = 0; i < 60; i++) {
    const w = G.map((r) => r.reduce((n, g, j) => n + g * v[j], 0))
    l = Math.hypot(...w)
    if (!l) return 0
    v = w.map((x) => x / l)
  }
  return l
}

function solve({ G, H }, T0, lambda, start, iters) {
  const L = top(G) + lambda
  if (!L) return start
  let [T, Z, tk] = [start, start, 1]
  for (let it = 0; it < iters; it++) {
    const next = Z.map((row, i) => simplex(row.map((z, j) => z - (G[i].reduce((n, g, k) => n + g * Z[k][j], 0) - H[i][j] + lambda * (z - T0[i][j])) / L)))
    const tn = (1 + Math.sqrt(1 + 4 * tk * tk)) / 2
    Z = next.map((row, i) => row.map((x, j) => x + ((tk - 1) / tn) * (x - T[i][j])))
    ;[T, tk] = [next, tn]
  }
  return T
}

const sse = (shares, T) => shares.reduce((n, { x, y, w }) => n + w * y.reduce((s, v, j) => s + (v - x.reduce((m, xi, i) => m + xi * T[i][j], 0)) ** 2, 0), 0)

const quantile = (values, q) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(q * values.length))]

/**
 * `units`: [{ x: [first-round groups], y: [runoff outcomes] }], one per place. `prior` (groups × outcomes) is what a group does when the places say nothing
 * about it, the overall behaviour by default; `ridge` is how hard the fit is held to it and `sensitivity` other strengths whose results widen the bounds.
 * Returns the transfer matrix `T` (groups × outcomes), its bounds (5% and 95% of a bootstrap over the places, widened by the other strengths), the share of the
 * squared error that the model removes against "everyone voted alike" (`fit`) and the number of places.
 */
export function estimate(units, { boot = 30, iters = 1500, seed = 1, ridge = 1e-3, sensitivity = [], prior } = {}) {
  const [plain, centered] = [shares(units, false), shares(units, true)]
  const all = plain.map((_, k) => k)
  const total = units.reduce((t, u) => t.map((v, j) => v + u.y[j]), units[0].y.map(() => 0))
  const sum = total.reduce((a, b) => a + b, 0)
  const alike = units[0].x.map(() => total.map((v) => v / sum))
  const T0 = prior ?? alike
  const [full, within] = [moments(plain, all), moments(centered, all)]
  const lambda = (m, r) => (r * m.G.reduce((n, row, i) => n + row[i], 0)) / units[0].x.length
  const T = solve(full, T0, lambda(full, ridge), T0, iters)
  const rand = mulberry32(seed)
  const boots = Array.from({ length: boot }, () => solve(moments(plain, all.map(() => Math.floor(rand() * plain.length))), T0, lambda(full, ridge), T, 300))
  const others = [...sensitivity.map((r) => solve(full, T0, lambda(full, r), T, iters)), solve(within, T0, lambda(within, ridge), T, iters)]
  const bound = (pick, q) => T.map((row, i) => row.map((v, j) => pick(v, ...others.map((r) => r[i][j]), ...(boots.length ? [quantile(boots.map((r) => r[i][j]), q)] : []))))
  return { T, low: bound(Math.min, 0.05), high: bound(Math.max, 0.95), fit: 1 - sse(plain, T) / sse(plain, alike), places: units.length }
}
