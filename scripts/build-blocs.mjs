// Builds two small tables of data/manifest.json:
//   spectrum   the left-right classification of the parties by period (scripts/spectrum/parties.csv, editorial: see the README)
//   endorsement  the finalist (to_n, the number) a first-round candidate (n) declared for in the runoff
//   coalition  every coalition, federation and isolated party of the TSE general elections 1994-2026 (open data consulta_coligacao)
//   nice -n 10 node scripts/build-blocs.mjs
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { parseCsvLine } from './csv.mjs'

const OUT = 'data'
const CACHE = '.cache'
const OPEN_DATA = 'https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_coligacao'
const YEARS = [1994, 1998, 2002, 2006, 2010, 2014, 2018, 2022, 2026]
const OFFICES = new Set(['1', '3', '5', '6', '7', '8']) // president, governor, senator, federal, state and district deputy (vices and substitutes follow their ticket)
const KINDS = { 'COLIGAÇÃO': 'coalition', 'PARTIDO ISOLADO': 'party', 'FEDERAÇÃO': 'federation' }
const BLOCS = ['E', 'CE', 'C', 'CD', 'D', 'N']

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const csvOf = (rows) => rows.map((r) => r.map((v) => (/[,"\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v)).join(',')).join('\n') + '\n'
/** The party as written in the TSE files and in `cands` folded to one key: `PC do B` and `PCDOB` are the same party. */
export const partyKey = (p) => p.toUpperCase().replace(/[^A-Z0-9ÃÕÇ]/g, '')

const manifest = JSON.parse(readFileSync(`${OUT}/manifest.json`, 'utf8'))

function register(name, columns, ddl, file, rows, body) {
  writeFileSync(`${OUT}/${file}`, gzipSync(body, { level: 9 }))
  manifest.tables[name] = { name, columns, ddl, parts: { all: { url: file, bytes: readFileSync(`${OUT}/${file}`).length, rows, rawBytes: Buffer.byteLength(body) } } }
  log(`${name}: ${rows} rows, ${manifest.tables[name].parts.all.bytes} bytes gz`)
}

function buildSpectrum() {
  const rows = readFileSync('scripts/spectrum/parties.csv', 'utf8').trim().split('\n').slice(1).map(parseCsvLine)
  for (const [party, from, to, bloc] of rows) {
    if (party !== partyKey(party)) throw new Error(`spectrum: ${party} is not a party key`)
    if (!BLOCS.includes(bloc) || +from > +to) throw new Error(`spectrum: invalid row ${party} ${from}-${to} ${bloc}`)
  }
  register('spectrum', 'party,from_year,to_year,bloc,confidence,lineage', 'create table spectrum (party text, from_year int, to_year int, bloc text, confidence text, lineage text)',
    'spectrum.csv.gz', rows.length, csvOf(rows))
}

function buildEndorsements() {
  const rows = readFileSync('scripts/spectrum/endorsements.csv', 'utf8').trim().split('\n').slice(1).map(parseCsvLine)
  register('endorsement', 'election,turn,n,to_n,source', 'create table endorsement (election int, turn int, n text, to_n text, source text)', 'endorsement.csv.gz', rows.length, csvOf(rows))
}

function download(year) {
  const zip = `${CACHE}/consulta_coligacao_${year}.zip`
  if (!existsSync(zip)) {
    mkdirSync(CACHE, { recursive: true })
    execFileSync('curl', ['-fsSL', '--retry', '3', '-o', zip, `${OPEN_DATA}/consulta_coligacao_${year}.zip`])
  }
  return zip
}

/** Fields of a `;` separated line with quoted values (the TSE files are latin1). */
const fields = (line) => parseCsvLine(line.replaceAll(';', ','))
const clean = (v) => (/^#(NULO|NE)#?$/.test(v) ? '' : v.trim().replace(/\s+/g, ' '))

function buildCoalitions() {
  const rows = []
  for (const year of YEARS) {
    const zip = download(year)
    const names = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).split('\n').filter((n) => n.endsWith('.csv'))
    for (const name of names) {
      const [head, ...lines] = execFileSync('unzip', ['-p', zip, name], { encoding: 'latin1', maxBuffer: 1 << 28 }).trim().split(/\r?\n/)
      const col = Object.fromEntries(fields(head).map((c, i) => [c, i]))
      for (const line of lines) {
        const f = fields(line)
        const [turn, uf, office, kind] = [f[col.NR_TURNO], f[col.SG_UF].toLowerCase(), f[col.CD_CARGO], KINDS[f[col.TP_AGREMIACAO]]]
        if (!OFFICES.has(office) || !kind) continue
        rows.push([year, turn, uf, office, f[col.SQ_COLIGACAO], kind, clean(f[col.NM_COLIGACAO]), partyKey(f[col.SG_PARTIDO]), clean(f[col.SG_FEDERACAO] ?? ''), clean(f[col.DS_SITUACAO]).toLowerCase()])
      }
    }
    log(`${year}: ${rows.length} rows so far`)
  }
  const unique = [...new Map(rows.map((r) => [r.join('|'), r])).values()] // the zips carry the national file twice (BR and BRASIL)
  unique.sort((a, b) => a.slice(0, 5).join('|').localeCompare(b.slice(0, 5).join('|')) || a[7].localeCompare(b[7]))
  register('coalition', 'election,turn,uf,office,seq,kind,name,party,federation,status',
    'create table coalition (election int, turn int, uf text, office int, seq text, kind text, name text, party text, federation text, status text)',
    'coalition.csv.gz', unique.length, csvOf(unique))
}

buildSpectrum()
buildEndorsements()
buildCoalitions()
manifest.version = manifest.version.replace(/^[^+]*/, new Date().toISOString())
writeFileSync(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 1) + '\n')
log('manifest written')
