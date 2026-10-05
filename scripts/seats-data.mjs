// Inputs of the seat calculation (tables lineup and annulled), built next to the other tables by build-data.mjs.
//   lineup   one row per party list of a UF and deputy office: its number, acronym, bloc (the federation or coalition it runs in, as
//            "A / B / C"), the bloc's name, whether its votes count, its valid legend votes (typed + converted from candidates rejected
//            after the election; 2026: counted in the shipped sections, plus the residual to the official total) and the official valid
//            votes of the list (nominal + legend), to check the sections of the dump against
//   annulled the candidates whose votes the official result does not count as nominal (annulled sub judice, registration rejected);
//            a candidate number is unique per UF/office, so (uf, office, n) is the key
// 2018/2022 come from the collector database (candidates, elected.valid_votes) and the TSE open-data party results (votacao_partido_munzona:
// legend and valid votes per party); 2026 from the official TSE state files (agr = bloc, par = party, cand.dvt = vote validity) and the RDV
// database for the legend votes.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { cached } from './geo.mjs'
import { parseCsvLine } from './csv.mjs'
import { UFS } from '../src/model.js'

const DEPUTIES = [6, 7, 8]
const ALIAS = { 'PC do B': 'PCDOB' } // the 2026 files and the party colours spell it PCDOB
const canon = (p) => ALIAS[p] ?? p
const rows = async (text, db, sql) => (await text(db, [sql])).trim().split('\n').filter(Boolean).map(parseCsvLine)
const legendSql = (where) => `select lower(state), office, left(e.key, 2), sum(e.value::int) from rdv_votes r, jsonb_each_text(r.votes->'1') e
  where office in (${DEPUTIES}) ${where} group by 1, 2, 3`
const legendOf = (list) => new Map(list.map(([uf, office, party, votes]) => [`${uf}/${office}/${party}`, +votes]))

// Numbers the sections hold votes for but the official candidate list does not know (cancelled or withdrawn after the urns were loaded)
function unlisted(el, known) {
  const seen = new Set()
  for (const line of gunzipSync(readFileSync(`data/res/${el.key}.csv.gz`)).toString().split('\n').filter(Boolean)) {
    const [, , uf, , office, n] = parseCsvLine(line)
    if (DEPUTIES.includes(+office) && !known.has(`${uf}/${office}/${n}`)) seen.add([uf, +office, n].join())
  }
  return [...seen].map((k) => k.split(','))
}

/** "PSDB / CIDADANIA" of "Federação PSDB Cidadania (PSDB / CIDADANIA)" or of a plain coalition list, sorted so every member agrees. */
const blocOf = (parties) => (/\((.*)\)$/.exec(parties)?.[1] ?? parties).split(' / ').map(canon).sort().join(' / ')
const nameOf = (coalition, parties, partyName) => (coalition === 'FEDERAÇÃO' ? parties.replace(/ \(.*\)$/, '') : coalition === 'PARTIDO ISOLADO' ? partyName : coalition)

// ---- 2018/2022: TSE open data, party results per municipality and zone ----------------------------------------------------------
const PARTY_ZIP = (year) => `https://cdn.tse.jus.br/estatistica/sead/odsele/votacao_partido_munzona/votacao_partido_munzona_${year}.zip`

async function partyZip(year) {
  const file = `.cache/votacao_partido_munzona_${year}.zip`
  if (!existsSync(file)) {
    mkdirSync('.cache', { recursive: true })
    const res = await fetch(PARTY_ZIP(year))
    if (!res.ok) throw new Error(`${PARTY_ZIP(year)}: HTTP ${res.status}`)
    writeFileSync(file, Buffer.from(await res.arrayBuffer()))
  }
  return file
}

// the TSE files are `;`-separated with quoted text and bare numbers
const fields = (line) => [...line.matchAll(/(?:^|;)("(?:[^"]|"")*"|[^;]*)/g)].map((m) => m[1].replace(/^"|"$/g, ''))

/** Official valid votes per UF/office/party of the first round: { legend, nominal, annulled } (legend = typed + converted votes). */
async function officialVotes(year) {
  const zip = await partyZip(year)
  const out = new Map()
  for (const name of execFileSync('unzip', ['-Z1', zip]).toString().split('\n').filter((n) => /_[A-Z]{2}\.csv$/.test(n) && !n.endsWith('_BR.csv') && !n.endsWith('_ZZ.csv'))) {
    const [head, ...lines] = execFileSync('unzip', ['-p', zip, name], { maxBuffer: 1 << 30 }).toString('latin1').trim().split('\n')
    const col = Object.fromEntries(head.replaceAll('"', '').split(';').map((c, i) => [c, i]))
    for (const line of lines) {
      const f = fields(line)
      const office = +f[col.CD_CARGO]
      if (+f[col.NR_TURNO] !== 1 || !DEPUTIES.includes(office)) continue
      const k = `${f[col.SG_UF].toLowerCase()}/${office}/${f[col.NR_PARTIDO]}`
      const v = out.get(k) ?? { legend: 0, nominal: 0, annulled: 0 }
      v.legend += +f[col.QT_TOTAL_VOTOS_LEG_VALIDOS]
      v.nominal += +f[col.QT_VOTOS_NOMINAIS_VALIDOS]
      v.annulled += +f[col.QT_VOTOS_LEGENDA_ANUL_SUBJUD] + +f[col.QT_VOTOS_NOMINAIS_ANUL_SUBJUD]
      out.set(k, v)
    }
  }
  return out
}

// Superseded lists (INAPTO) are left out; a party whose votes are all annulled had its list annulled (its legend votes too)
const openLineupSql = (turn) => `select lower(c.state), c.office, c.party_number, min(c.party), min(c.party_name), min(c.coalition), min(c.coalition_parties)
  from candidates c where c.turn = ${turn} and c.office in (${DEPUTIES}) and c.status = 'APTO' group by 1, 2, 3 order by 1, 2, 3`

async function openData(el, { text }) {
  const db = el.source.db
  const official = await officialVotes(el.year)
  const lineup = (await rows(text, db, openLineupSql(el.turn))).map(([uf, office, party, sigla, partyName, coalition, parties]) => {
    const o = official.get(`${uf}/${office}/${party}`) ?? { legend: 0, nominal: 0, annulled: 0 }
    const valid = o.legend + o.nominal > 0 || o.annulled === 0
    return [uf, office, party, canon(sigla), blocOf(parties), nameOf(coalition, parties, partyName), valid, o.legend, 0, o.legend + o.nominal]
  })
  // candidates rejected before the election are not in the official result at all, although the urns still counted their votes; a number
  // can have a superseded (INAPTO) registration next to the valid one, so a number is annulled only when none of its registrations counts
  const annulled = await rows(text, db, `select lower(c.state), c.office, c.number from candidates c left join elected e on e.sq_candidato = c.sq_candidato and e.turn = c.turn
    where c.turn = ${el.turn} and c.office in (${DEPUTIES}) group by 1, 2, 3 having not coalesce(bool_or(e.valid_votes = e.votes), false) order by 1, 2, 3`)
  const known = new Set((await rows(text, db, `select distinct lower(state), office, number from candidates where turn = ${el.turn} and office in (${DEPUTIES})`)).map((r) => r.join('/')))
  return { lineup, annulled: [...annulled, ...unlisted(el, known)] }
}

// ---- 2026: official state files + the RDV database ------------------------------------------------------------------------------
const stateFile = async (uf, office) => {
  const url = `https://resultados.tse.jus.br/oficial/ele2026/6259/dados/${uf}/${uf}-c${String(office).padStart(4, '0')}-e006259-u.jws`
  const body = await cached(`tse-${uf}-${office}.jws`, url, { fresh: true })
  return JSON.parse(Buffer.from(body.trim().split('.')[1], 'base64url').toString()).carg[0]
}

const offices = (uf) => (uf === 'df' ? [6, 8] : [6, 7])

// The residual of the legend votes is the official total of the party minus what the shipped sections hold (the same idea as the residual table).
async function rdvData(el, { text }) {
  const dump = legendOf(await rows(text, el.source.db, legendSql('')))
  const [lineup, annulled, known] = [[], [], new Set()]
  for (const uf of UFS.filter((u) => u !== 'zz')) {
    for (const office of offices(uf)) {
      for (const agr of (await stateFile(uf, office)).agr) {
        for (const p of agr.par) {
          const [counted, cands] = [dump.get(`${uf}/${office}/${p.n}`) ?? 0, p.cand ?? []]
          lineup.push([uf, office, p.n, p.sg, agr.com, agr.nm, p.dvt.startsWith('Válido'), counted, Math.max(0, +p.tvtl - counted), +p.tvtn + +p.tvtl])
          annulled.push(...cands.filter((c) => c.dvt !== 'Válido').map((c) => [uf, office, c.n]))
          cands.forEach((c) => known.add(`${uf}/${office}/${c.n}`))
        }
      }
    }
  }
  return { lineup, annulled: [...annulled, ...unlisted(el, known)] }
}

export async function buildSeatsData(el, helpers) {
  const { lineup, annulled } = await (el.source.kind === 'open' ? openData : rdvData)(el, helpers)
  helpers.smallTable('lineup', el, lineup)
  helpers.smallTable('annulled', el, annulled)
}
