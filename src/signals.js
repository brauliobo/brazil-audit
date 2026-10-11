// Screening of sections by how far they stand from their neighbours, shared by the data build (scripts/signals-data.mjs, which stores
// the result in table sg) and the Sinais view. Pure functions, no browser globals. A signal is a reason to look at a section, never
// proof of anything: atypical turnout, late voting and manual release all have ordinary causes (see the notes in the locale files).
//
// Three core criteria (the first three signals), as in the public tool of the video this view reproduces (github.com/ralbuque/esteleicao):
//   abstention  turnout well above its neighbours: z <= -3 against the other sections of the city, with at least 50 voters on the roll
//   late        at least 15% of the votes at 17h or later (Brasilia time), at least 10 of them, and, when the school has other sections, an
//               average voting time at least 30 minutes later than theirs
//   manual      voters released by the poll worker after their fingerprint failed: z >= 3 against the other sections of the city, at least 5
// The other signals only complement them in the section page. fast and idle come from the pace of the section (table vt, the data of
// the Horários view): the median time between two votes, and the longest gap between two votes.

export const SIGNALS = ['abstention', 'late', 'manual', 'late10', 'lateNoFp', 'turnout', 'noFp', 'streak', 'schoolNoFp', 'later', 'fast', 'idle']
export const TABS = ['abstention', 'late', 'nofp', 'cross'] // analyses of the Sinais view, the first needs no log
export const CORE = 7 // bit mask of the three core criteria
export const bit = (id) => 1 << SIGNALS.indexOf(id)

export const FIRST_HOUR = 5 // hourly arrays (hv, hm, hn) start at 05h Brasilia time and end at 19h
export const HOURS = 15
export const LATE_FROM = 17 - FIRST_HOUR // index of the 17h bucket

const MIN_CITY = 6 // a city with fewer sections (fewer than 5 others) is compared with its state
const MAD = 1.4826 // scales the median absolute deviation to a standard deviation

export const LIMITS = { z: 3, aptos: 50, lateShare: 0.15, lateShareLoose: 0.1, late: 10, laterMin: 30, laterMinLoose: 60, manual: 5, noFp: 5, streak: 8, schoolNoFp: 25, fastMedian: 45, paced: 60, idleGap: 7200 }

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const sum = (xs) => xs.reduce((a, b) => a + b, 0)

/**
 * z-score of `x` events out of `n` trials of each row against the other rows of its city (of its state when the city has fewer than
 * MIN_CITY rows with trials): (x - n·p) / sqrt(n·p·(1 - p)), p being the rate of the others. The binomial z is too large for almost
 * every section because places differ for ordinary reasons, so each state's z is divided by the square root of its robust
 * overdispersion (1.4826·MAD of the z, squared, when above 1). Rows without trials, or without others, have no z.
 */
export function zScores(rows, x, n) {
  const totals = (key) => {
    const m = new Map()
    for (const r of rows) if (r[n] > 0) { const t = m.get(key(r)) ?? [0, 0, 0]; t[0] += r[x]; t[1] += r[n]; t[2]++; m.set(key(r), t) }
    return m
  }
  const [city, state] = [totals((r) => `${r.state}|${r.city}`), totals((r) => r.state)]
  const raw = rows.map((r) => {
    if (!(r[n] > 0)) return null
    const [cx, cn, k] = city.get(`${r.state}|${r.city}`)
    const [rx, rn] = k >= MIN_CITY ? [cx, cn] : state.get(r.state)
    if (rn - r[n] <= 0) return null
    const p = (rx - r[x]) / (rn - r[n])
    const variance = r[n] * p * (1 - p)
    return variance > 0 ? (r[x] - r[n] * p) / Math.sqrt(variance) : null
  })
  const byState = new Map()
  rows.forEach((r, i) => raw[i] != null && byState.set(r.state, [...(byState.get(r.state) ?? []), raw[i]]))
  const scale = new Map([...byState].map(([s, zs]) => { const m = median(zs); return [s, Math.sqrt(Math.max((MAD * median(zs.map((z) => Math.abs(z - m)))) ** 2, 1))] }))
  return raw.map((z, i) => (z == null ? null : z / scale.get(rows[i].state)))
}

/** The values of a list of hourly counts re-based from the machine's clock to Brasilia time (`tz` hours ahead), the ends absorbing what falls outside. */
export function toBrasilia(hours, tz) {
  const out = Array(HOURS).fill(0)
  hours.forEach((v, i) => { out[Math.min(Math.max(i - tz, 0), HOURS - 1)] += v })
  return out
}

/** Average time of day of the votes of hourly counts, in hours (the middle of each hour). */
export const meanHour = (hv) => (sum(hv) ? sum(hv.map((v, i) => v * (FIRST_HOUR + i + 0.5))) / sum(hv) : null)

/** For each row, the ratio Σx / Σy of `ratio(row)` = [x, y] over the other rows of its school, or null when it has no other row with y > 0. */
export function others(rows, school, ratio) {
  const groups = new Map()
  for (const r of rows) {
    const [x, y] = ratio(r)
    const t = groups.get(school(r)) ?? [0, 0]
    groups.set(school(r), [t[0] + x, t[1] + y])
  }
  return rows.map((r) => {
    const [a, b] = groups.get(school(r))
    const [x, y] = ratio(r)
    return b - y > 0 ? (a - x) / (b - y) : null
  })
}

/** The signals (bit mask) of a section from its stored columns; the ones that need the machine's log are off for elections without it. */
export function signalsOf(r) {
  if (r.v == null) return r.zabs != null && r.zabs <= -LIMITS.z && r.aptos >= LIMITS.aptos ? bit('abstention') : 0
  const late = r.v ? r.lt / r.v : 0
  const lateNoFp = sum(r.hm.slice(LATE_FROM)) + sum(r.hn.slice(LATE_FROM))
  const flags = {
    abstention: r.zabs != null && r.zabs <= -LIMITS.z && r.aptos >= LIMITS.aptos,
    late: late >= LIMITS.lateShare && r.lt >= LIMITS.late && (r.dlate == null || r.dlate >= LIMITS.laterMin),
    manual: r.zman != null && r.zman >= LIMITS.z && r.man >= LIMITS.manual,
    late10: late >= LIMITS.lateShareLoose && r.lt >= LIMITS.late,
    lateNoFp: r.lt >= LIMITS.late && lateNoFp > r.lt / 2,
    turnout: r.v != null && r.v !== r.comp,
    noFp: r.znf != null && r.znf >= LIMITS.z && r.man + r.nor >= LIMITS.noFp,
    streak: r.run >= LIMITS.streak,
    schoolNoFp: r.dnf != null && r.dnf >= LIMITS.schoolNoFp,
    later: r.dlate != null && r.dlate >= LIMITS.laterMinLoose,
    fast: r.v >= LIMITS.paced && r.med != null && r.med <= LIMITS.fastMedian,
    idle: r.v >= LIMITS.paced && r.gap >= LIMITS.idleGap,
  }
  return SIGNALS.reduce((m, id) => m | (flags[id] ? bit(id) : 0), 0)
}
