// Tables sg, sgf and sgz of build-data.mjs: how far each section stands from its neighbours (src/signals.js).
//   sg   one row per section: the roll (aptos), the turnout (comp) and abstention z, and, for elections with the machines' logs, how
//        the voters were identified (bio, man, nor, run), their hours (hv all votes, hm manual, hn no fingerprint registered, Brasilia
//        time 05h-19h), the late votes (lt), the other z-scores and the gaps to the school; `fl` is the bit mask of the signals; med and
//        gap are the pace of the section (median seconds between votes, longest gap) taken from vt, the table of the Horários view
//   sgf  the rows of sg with a core signal, loaded whole so lists across Brazil never need the section parts
//   sgz  one row per zone with the sums of sg (the national and state charts never scan sections)
// Sources: the TSE open data "detalhe da apuração por seção" (aptos, comparecimento, local de votação), and for the logs the output of
// tools/logscan (Rust, `npm run logscan`; IDENT_DIR, one directory per election) with the clock offsets of vtc.
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { gunzipSync } from 'node:zlib'
import { parseCsvLine } from './csv.mjs'
import { FIRST_HOUR, HOURS, LATE_FROM, meanHour, others, signalsOf, toBrasilia, zScores, CORE } from '../src/signals.js'

const CACHE = '.cache'
const OPEN_DATA = 'https://cdn.tse.jus.br/estatistica/sead/odsele/detalhe_votacao_secao'
const pad = (v, n) => String(v).padStart(n, '0')
const sum = (xs) => xs.reduce((a, b) => a + b, 0)
const lines = (file) => gunzipSync(readFileSync(file)).toString().trim().split('\n')
const round = (v, d = 2) => (v == null || !Number.isFinite(v) ? null : +v.toFixed(d))

// ---- inputs -----------------------------------------------------------------------------------------------------------------
async function detail(el) {
  const zip = `${CACHE}/detalhe_votacao_secao_${el.year}.zip`
  if (!existsSync(zip)) {
    mkdirSync(CACHE, { recursive: true })
    execFileSync('curl', ['-fsSL', '--retry', '3', '-o', zip, `${OPEN_DATA}/detalhe_votacao_secao_${el.year}.zip`])
  }
  const names = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).split('\n').filter((n) => n.endsWith('.csv'))
  const files = names.some((n) => n.endsWith('_BR.csv')) ? names.filter((n) => n.endsWith('_BR.csv')) : names // BR holds the president of every UF
  const rows = new Map()
  for (const name of files) {
    const p = spawn('unzip', ['-p', zip, name])
    p.stdout.setEncoding('latin1')
    let col
    for await (const line of createInterface({ input: p.stdout, crlfDelay: Infinity })) {
      const f = line.split(';').map((v) => v.replace(/^"|"$/g, ''))
      if (!col) { col = Object.fromEntries(f.map((c, i) => [c, i])); continue }
      if (+f[col.CD_CARGO] !== 1 || +f[col.NR_TURNO] !== el.turn) continue
      const [state, city, zone, section] = [f[col.SG_UF].toLowerCase(), pad(f[col.CD_MUNICIPIO], 5), pad(f[col.NR_ZONA], 4), pad(f[col.NR_SECAO], 4)]
      rows.set(`${state}|${city}|${zone}|${section}`, { state, code: city, zone, section, place: f[col.NM_MUNICIPIO], school: +f[col.NR_LOCAL_VOTACAO], aptos: +f[col.QT_APTOS], comp: +f[col.QT_COMPARECIMENTO] })
    }
  }
  return rows
}

const names = () => new Map(lines('data/mun_map.csv.gz').map((l) => parseCsvLine(l)).map(([state, city, , code]) => [`${state}|${code}`, city]))
const clocks = (el) => new Map(lines(`data/vtc/${el.key}.csv.gz`).map((l) => parseCsvLine(l)).map((f) => [`${f[2]}|${f[3]}`, +f[6]]))

/** The pace of each section (median seconds between votes, longest gap) from the vt parts of the Horários view, by section. */
const paces = (el) => new Map(readdirSync('data/vt').filter((f) => new RegExp(`^${el.key}-[a-z]{2}\\.csv\\.gz$`).test(f)).flatMap((f) =>
  lines(`data/vt/${f}`).map((l) => parseCsvLine(l)).map((f) => [f.slice(2, 6).join('|'), { med: f[10] === '' ? null : +f[10], gap: f[13] === '' ? null : +f[13] }])))

/** The output of logscan of an election, by section. */
function idents(dir) {
  const out = new Map()
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.tsv'))) {
    for (const line of readFileSync(`${dir}/${file}`, 'utf8').split('\n')) {
      if (!line) continue
      const f = line.split('\t')
      if (f.length !== 12) throw new Error(`${file}: ${f.length} columns, logscan writes 12 (parse the archive again)`)
      const [state, city, zone, section, v, bio, man, nor, run, hv, hm, hn] = f
      out.set(`${state}|${city}|${zone}|${section}`, { v: +v, bio: +bio, man: +man, nor: +nor, run: +run, hv: hv.split(',').map(Number), hm: hm.split(',').map(Number), hn: hn.split(',').map(Number) })
    }
  }
  return out
}

// ---- the table --------------------------------------------------------------------------------------------------------------
const NOLOG = { v: null, bio: null, man: null, nor: null, run: null, hv: null, hm: null, hn: null, med: null, gap: null }

export async function sectionRows(el, { identDir } = {}) {
  const [open, name] = [await detail(el), names()]
  const [log, tz, pace] = el.hasTimes ? [idents(identDir), clocks(el), paces(el)] : [new Map(), new Map(), new Map()]
  const rows = []
  for (const [key, d] of open) {
    const city = name.get(`${d.state}|${d.code}`) ?? (d.state === 'zz' ? d.place : null) // posts abroad that no results file lists
    if (!city) throw new Error(`${el.key}: city code ${d.state}/${d.code} is not in mun_map`)
    const l = log.get(key)
    const shift = (h) => toBrasilia(h, tz.get(`${d.state}|${city}`) ?? 0)
    rows.push({ ...d, city, ...(l ? { ...l, hv: shift(l.hv), hm: shift(l.hm), hn: shift(l.hn), ...(pace.get(`${d.state}|${city}|${d.zone}|${d.section}`) ?? { med: null, gap: null }) } : NOLOG), absent: d.aptos - d.comp })
  }
  if (el.hasTimes && !log.size) throw new Error(`${el.key}: no logscan output in ${identDir}`)
  return withScores(rows)
}

function withScores(rows) {
  const logged = rows.filter((r) => r.v != null)
  const [zabs, zman, znf] = [zScores(rows.map((r) => ({ ...r, n: r.aptos })), 'absent', 'n'), zScores(logged.map((r) => ({ ...r, n: r.bio + r.man })), 'man', 'n'), zScores(logged.map((r) => ({ ...r, n: r.v, x: r.man + r.nor })), 'x', 'n')]
  const school = (r) => `${r.state}|${r.city}|${r.school}`
  const [peerNoFp, peerHour] = [others(logged, school, (r) => [r.man + r.nor, r.v]), others(logged, school, (r) => [sum(r.hv.map((v, i) => v * (i + 0.5))), r.v])]
  rows.forEach((r, i) => { r.zabs = round(zabs[i]) })
  logged.forEach((r, i) => {
    r.zman = round(zman[i])
    r.znf = round(znf[i])
    r.lt = sum(r.hv.slice(LATE_FROM))
    const hour = meanHour(r.hv)
    r.dlate = peerHour[i] == null || hour == null ? null : round((hour - FIRST_HOUR - peerHour[i]) * 60, 0)
    r.dnf = peerNoFp[i] == null || !r.v ? null : round(100 * ((r.man + r.nor) / r.v - peerNoFp[i]), 1)
  })
  for (const r of rows) r.fl = signalsOf(r)
  return rows
}

// ---- parts ------------------------------------------------------------------------------------------------------------------
const arr = (a) => (a ? `{${a.join(',')}}` : '')
export const sgCsv = (el, r) => [el.year, el.turn, r.state, r.city, r.zone, r.section, r.school, r.aptos, r.comp, r.zabs, r.v, r.bio, r.man, r.nor, r.run, arr(r.hv), arr(r.hm), arr(r.hn), r.lt, r.zman, r.znf, r.dlate, r.dnf, r.fl, r.med, r.gap]
export const sgzRows = (rows) => {
  const zones = new Map()
  for (const r of rows) {
    const z = zones.get(`${r.state}|${r.city}|${r.zone}`) ?? { state: r.state, city: r.city, zone: r.zone, sections: 0, aptos: 0, comp: 0, v: 0, bio: 0, man: 0, nor: 0, lt: 0, hv: Array(HOURS).fill(0), hm: Array(HOURS).fill(0), hn: Array(HOURS).fill(0), flagged: 0 }
    zones.set(`${r.state}|${r.city}|${r.zone}`, z)
    z.sections++; z.aptos += r.aptos; z.comp += r.comp; z.flagged += (r.fl & CORE) ? 1 : 0
    if (r.v != null) {
      z.v += r.v; z.bio += r.bio; z.man += r.man; z.nor += r.nor; z.lt += r.lt
      for (const k of ['hv', 'hm', 'hn']) r[k].forEach((v, i) => (z[k][i] += v))
    }
  }
  return [...zones.values()]
}
export const sgzCsv = (el, z) => [el.year, el.turn, z.state, z.city, z.zone, z.sections, z.aptos, z.comp, z.v, z.bio, z.man, z.nor, z.lt, arr(z.hv), arr(z.hm), arr(z.hn), z.flagged]
