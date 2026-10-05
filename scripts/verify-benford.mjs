// Reads the shipped Benford parts (data/benford) and prints the numbers of the validation report with the same stats module the
// app uses: national president histograms, statistics and envelopes, and how many UFs / municipalities fall outside the envelope.
//   node scripts/verify-benford.mjs [election ...]
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { ELECTIONS } from '../src/elections.js'
import { parseCsvLine } from './csv.mjs'
import { analyze } from '../src/benford/analysis.js'
import { DIGITS } from '../src/benford/stats.js'

const host = JSON.parse(readFileSync('data/manifest.json', 'utf8')).tables
const read = (table, part) => gunzipSync(readFileSync(`data/${host[table].parts[part].url}`)).toString().trim().split('\n').map(parseCsvLine)
const scopeKey = (r) => r.slice(0, 8).join('|')

/** Every scope of an election as { key, fields, counts, base, stat } (parts of all places). */
function scopes(election) {
  const out = new Map()
  const parts = Object.keys(host.benford_hist.parts).filter((k) => k.startsWith(`${election}/`))
  for (const part of parts) {
    for (const r of read('benford_hist', part)) {
      const s = out.get(scopeKey(r)) ?? { fields: r.slice(0, 8), counts: [], base: [], stat: {} }
      s.counts[+r[8] - DIGITS[r[7]][0]] = +r[9]
      out.set(scopeKey(r), s)
    }
    for (const r of read('benford_base', part)) out.get(scopeKey(r)).base[+r[8] - DIGITS[r[7]][0]] = { mean: +r[9], lo: +r[10], hi: +r[11] }
    for (const r of read('benford_stat', part)) out.get(scopeKey(r)).stat[r[8]] = { mean: +r[9], lo: +r[10], hi: +r[11] }
  }
  return [...out.values()].map((s) => ({ ...s, unit: s.fields[3], uf: s.fields[4], city: s.fields[5], cand: s.fields[6], pos: s.fields[7], office: s.fields[2] }))
}

const f = (x, d = 4) => x.toFixed(d)
const row = (s) => {
  const a = analyze(s.pos, s.counts, s.base, s.stat.mad ? s.stat : null)
  return { s, a }
}

function national(all, election) {
  const leaders = all.filter((x) => x.office === '1' && x.unit === 'section' && x.uf === 'br' && !x.city && x.pos === 'd1' && x.cand !== 'nominal' && !/^(branco|nulo)$/.test(x.cand))
    .map((x) => [x.cand, x.counts.reduce((t, c) => t + c, 0)]).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([c]) => c)
  for (const cand of [...leaders, 'nominal']) {
    for (const pos of ['d1', 'd2']) {
      const s = all.find((x) => x.office === '1' && x.unit === 'section' && x.uf === 'br' && !x.city && x.cand === cand && x.pos === pos)
      if (!s) continue
      const { a } = row(s)
      console.log(`${election} president ${cand} ${pos}: N=${a.n} chi2=${f(a.chi2, 1)} df=${a.df} p=${a.p.toExponential(2)} MAD=${f(a.mad, 5)} (${a.madClass}) baseline MAD ${f(a.baseline.mad.mean, 5)} [${f(a.baseline.mad.lo, 5)}, ${f(a.baseline.mad.hi, 5)}] verdict=${a.verdict}`)
      console.log(`  obs  ${a.props.map((p) => f(p, 4)).join(' ')}`)
      console.log(`  law  ${a.probs.map((p) => f(p, 4)).join(' ')}`)
      console.log(`  mean ${a.baseline.digits.map((d) => f(d.mean, 4)).join(' ')}`)
      console.log(`  lo   ${a.baseline.digits.map((d) => f(d.lo, 4)).join(' ')}`)
      console.log(`  hi   ${a.baseline.digits.map((d) => f(d.hi, 4)).join(' ')}`)
    }
  }
}

function outside(all, election) {
  const levels = { UF: (x) => x.uf !== 'br' && !x.city, municipality: (x) => x.city }
  for (const office of [...new Set(all.map((x) => x.office))].sort()) {
    for (const [name, test] of Object.entries(levels)) {
      for (const pos of ['d1', 'd2']) {
        const tally = {}
        for (const s of all.filter((x) => x.office === office && x.unit === 'section' && test(x) && x.pos === pos && x.stat.mad)) {
          const { a } = row(s)
          tally[a.verdict] = (tally[a.verdict] ?? 0) + 1
        }
        const n = Object.values(tally).reduce((t, v) => t + v, 0)
        if (n) console.log(`${election} office ${office} ${name} ${pos}: ${n} scopes ${Object.entries(tally).map(([k, v]) => `${k} ${v} (${(100 * v / n).toFixed(1)}%)`).join(', ')}`)
      }
    }
  }
}

for (const election of process.argv.length > 2 ? process.argv.slice(2) : Object.keys(ELECTIONS)) {
  const all = scopes(election)
  console.log(`== ${election}: ${all.length} scopes`)
  national(all, election)
  outside(all, election)
}
