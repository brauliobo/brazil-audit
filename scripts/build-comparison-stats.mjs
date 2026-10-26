// Derived, bounded artifacts for comparisons: reading every section is a build task, not a browser task.
import { createReadStream, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { createGunzip, gzipSync } from 'node:zlib'
import { createInterface } from 'node:readline'
import { createHash } from 'node:crypto'
import { ELECTION_LIST } from '../src/elections.js'
import { parseCsvLine } from './csv.mjs'
import { sectionStatistics } from './comparison/section-stats.mjs'
const manifest = JSON.parse(readFileSync('data/manifest.json'))
const index = { schemaVersion: 1, generatedAt: new Date().toISOString(), sourceManifest: manifest.version, aggregation: 'equal_weight_section_statistics', elections: [] }
mkdirSync('data/comparison-stats',{recursive:true})
for (const election of ELECTION_LIST.filter((e) => e.hasTimes)) {
  const groups = new Map()
  const sources = []
  const vtc = Object.entries(manifest.tables.vtc.parts).find(([id]) => id.startsWith(`${election.key}/`))[1]
  const { gunzipSync } = await import('node:zlib')
  const clocks = new Map(gunzipSync(readFileSync(`data/${vtc.url}`)).toString().trim().split('\n').map((line) => { const f = parseCsvLine(line); return [`${f[2]}|${f[3]}`,Number(f[6])] }))
  for (const [id, part] of Object.entries(manifest.tables.vt.parts).filter(([id]) => id.startsWith(`${election.key}/`))) {
    sources.push({ id, sha256: createHash('sha256').update(readFileSync(`data/${part.url}`)).digest('hex') })
    const input = createReadStream(`data/${part.url}`).pipe(createGunzip())
    for await (const line of createInterface({input,crlfDelay:Infinity})) {
      const f = parseCsvLine(line.slice(0,line.lastIndexOf(',"{')))
      const tz = clocks.get(`${f[2]}|${f[3]}`)
      if (tz == null) throw new Error(`Missing city clock: ${election.key}/${f[2]}/${f[3]}`)
      const row = { first: +f[8]-3600*tz, last: +f[9]-3600*tz, med: f[10] === '' ? null : +f[10], p10: f[11] === '' ? null : +f[11], p90: f[12] === '' ? null : +f[12], maxgap: f[13] === '' ? null : +f[13] }
      for (const key of ['br||',`uf|${f[2]}|`,`city|${f[2]}|${f[3]}`]) {
        if (!groups.has(key)) groups.set(key,[])
        groups.get(key).push(row)
      }
    }
  }
  const rows = [...groups].map(([key,sections]) => { const [scope,state,city] = key.split('|'); return { scope,state,city,...sectionStatistics(sections) } })
  const path = `comparison-stats/${election.key}.json.gz`
  const body = gzipSync(JSON.stringify({ election: election.key, rows }),{level:9})
  writeFileSync(`data/${path}`,body)
  index.elections.push({ key:election.key,path,rows:rows.length,bytes:body.length,sha256:createHash('sha256').update(body).digest('hex'),sources })
  console.log(`${election.key}: ${rows.length} geographical aggregates, ${rows.find((r) => r.scope === 'br').sections} sections`)
}
writeFileSync('data/comparison-stats/index.json',JSON.stringify(index,null,2)+'\n')
