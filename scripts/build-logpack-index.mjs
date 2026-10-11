// Writes data/logs/<key>.json: which pack holds which sections, from the packs `logscan pack` wrote (src/logpack.js reads it in the browser).
// An entry is [stem, first key, last key, sections, pack bytes, index bytes]; the keys are `<uf>-<city>-<zone>-<section>` like the release's INDEX.json.
//   node scripts/build-logpack-index.mjs <key> <dir with <key>-logpack-<uf>-<nn>.pack/.idx>
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs'
import { inflate, parseIndex, sectionKey } from '../src/logpack.js'

const [key, dir] = process.argv.slice(2)
if (!key || !dir) throw new Error('usage: node scripts/build-logpack-index.mjs <key> <dir>')
const stems = readdirSync(dir).filter((f) => f.startsWith(`${key}-logpack-`) && f.endsWith('.idx')).map((f) => f.slice(0, -4)).sort()
const assets = []
for (const stem of stems) {
  const { records } = parseIndex(await inflate(readFileSync(`${dir}/${stem}.idx`)))
  const keys = records.map((r) => sectionKey(stem.split('-')[2], r.city, r.zone, r.section)).sort()
  assets.push([stem, keys[0], keys.at(-1), records.length, statSync(`${dir}/${stem}.pack`).size, statSync(`${dir}/${stem}.idx`).size])
}
mkdirSync('data/logs', { recursive: true })
writeFileSync(`data/logs/${key}.json`, JSON.stringify({ assets }))
console.log(`data/logs/${key}.json: ${assets.length} packs, ${assets.reduce((n, a) => n + a[3], 0)} sections, ${(assets.reduce((n, a) => n + a[4] + a[5], 0) / 1e6).toFixed(1)} MB`)
