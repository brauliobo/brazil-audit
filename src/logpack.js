// Reads the section logs published as packs (written by `logscan pack`, format in tools/logscan/src/pack.rs): per source archive a `.pack`
// (one raw-deflate blob per urn) and an `.idx` (templates + one record per blob). A browser cannot read GitHub release assets (no CORS),
// so both files are served by a static host that honours Range (raw.githubusercontent.com, Pages): the index once, then only the bytes of
// the section asked for. Pure functions plus fetch; no framework, so tests and scripts use it as it is.
import { REPO } from './elections.js'

export const METHODS = ['fingerprint', 'afterTry', 'withoutTry'] // how the voter was enabled: flags & 3
export const BRANCH = 'data-logs' // branch of REPO that holds the packs (git file limit 100 MB; a pack is ~2.5% of the archive it comes from)
export const packsUrl = (key) => `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${key}/`

const pad = (n, width) => String(n).padStart(width, '0')
/** `uf-city-zone-section` with the widths of the release keys (the TSE city code, 4-digit zone and section). */
export const sectionKey = (uf, city, zone, section) => `${uf}-${pad(city, 5)}-${pad(zone, 4)}-${pad(section, 4)}`

const configs = new Map()
/** data/logs/<key>.json of the dump (`{ assets }`, written by scripts/build-logpack-index.mjs), fetched once. Browser only. */
export const loadConfig = (key) => configs.get(key) ?? configs.set(key, fetch(`${import.meta.env.BASE_URL}data/logs/${key}.json`).then((r) => r.json())).get(key)

/** The assets of the config that hold the section: [stem, first, last, sections, packBytes, idxBytes], the keys compared as strings. */
export const findPack = (config, key) => config.assets.filter(([, first, last]) => first <= key && key <= last)

export const inflate = async (bytes) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer())
const text = new TextDecoder()

/** { dict, records: [{ city, zone, section, offset, length }] } of an inflated `.idx`. */
export function parseIndex(raw) {
  const v = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
  if (text.decode(raw.subarray(0, 4)) !== 'LGX1') throw new Error('not a logpack index') // i18n-ignore
  let p = 12
  const dict = Array.from({ length: v.getUint32(8, true) }, () => {
    const n = v.getUint16(p, true)
    p += 2 + n
    return text.decode(raw.subarray(p - n, p))
  })
  const records = Array.from({ length: v.getUint32(4, true) }, () => {
    const r = { city: v.getUint32(p, true), zone: v.getUint16(p + 4, true), section: v.getUint16(p + 6, true), offset: v.getUint32(p + 8, true), length: v.getUint32(p + 12, true) }
    p += 16
    return r
  })
  return { dict, records }
}

const HOLE = /\{(\d?)\}/g
const fill = (shape, params) => shape.replace(HOLE, (_, width) => String(params.shift()).padStart(Number(width), '0'))

function reader(b) {
  let p = 0
  const varint = () => {
    let n = 0
    for (let scale = 1; ; scale *= 128) {
      const c = b[p++]
      n += (c & 127) * scale
      if (c < 128) return n
    }
  }
  return { varint, take: (n) => b.subarray(p, (p += n)) }
}

/**
 * A section's blob: voters [{ enabled, done, method, tries, corrected, wrong }] in seconds of the voting day (the urn's own clock) and the lines
 * outside the voters' ordinary cycles [{ secs, level, module, text }]. Numbers of 10 or more digits (people's ids) were never stored (`#`).
 */
export function parseBlob(raw, dict) {
  const r = reader(raw)
  const [voters, events, otherDays] = [r.varint(), r.varint(), r.varint()]
  const gaps = Array.from({ length: voters }, () => r.varint()).map((n) => (n % 2 ? -(n + 1) / 2 : n / 2))
  const durs = Array.from({ length: voters }, () => r.varint())
  const [flags, wrong] = [r.take(voters), r.take(voters)]
  let done = 0
  const list = gaps.map((gap, i) => {
    const enabled = done + gap
    done = enabled + durs[i]
    return { enabled, done, method: flags[i] & 3, corrected: (flags[i] & 4) > 0, tries: flags[i] >> 3, wrong: wrong[i] }
  })
  let secs = 0
  const lines = Array.from({ length: events }, () => {
    secs += r.varint()
    const id = r.varint()
    const full = id ? fill(dict[id - 1], [...dict[id - 1].matchAll(HOLE)].map(() => r.varint())) : text.decode(r.take(r.varint()))
    const [level, module, ...message] = full.split('|')
    return { secs, level, module, text: message.join('|') }
  })
  return { voters: list, events: lines, otherDays }
}

/** `10:40`, `10h40`, `10h` or `1040` as seconds of the day, null when it is not a time. */
export function parseClock(s) {
  const m = /^(\d{1,2})(?:[:h]?(\d{2})?)?$/.exec(String(s ?? '').trim())
  return m && Number(m[1]) < 24 && Number(m[2] ?? 0) < 60 ? Number(m[1]) * 3600 + Number(m[2] ?? 0) * 60 : null
}

/** The voters whose cycle (enabled to voted) touches [from, to] and the other lines inside it; no window = everything. */
export function inWindow(section, from, to) {
  if (from == null) return section
  return { ...section, voters: section.voters.filter((v) => v.done >= from && v.enabled <= to), events: section.events.filter((e) => e.secs >= from && e.secs <= to) }
}

async function fetchBytes(url, range) {
  const res = await fetch(url, range && { headers: { Range: `bytes=${range[0]}-${range[0] + range[1] - 1}` } })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`)
  const bytes = new Uint8Array(await res.arrayBuffer())
  return range && res.status === 200 ? bytes.subarray(range[0], range[0] + range[1]) : bytes // a host without Range sends the whole file
}

const indexes = new Map()
const loadIndex = (url) => {
  if (!indexes.has(url)) indexes.set(url, fetchBytes(url).then(inflate).then(parseIndex).catch((e) => (indexes.delete(url), Promise.reject(e))))
  return indexes.get(url)
}

/**
 * Downloads one section: the index of the pack that holds it (cached) and the bytes of its urns. Resolves to
 * { urns: [{ voters, events, otherDays }], bytes, index } (a section with two urns, e.g. after a contingency, has two logs), urns empty when absent;
 * `bytes` is what the urns' blobs weigh and `index` the size of the pack's index, downloaded once and then cached.
 */
export async function loadSection(config, base, { uf, city, zone, section }) {
  const [asset] = findPack(config, sectionKey(uf, city, zone, section))
  if (!asset) return { urns: [], bytes: 0, index: 0 }
  const [stem, , , , , index] = asset
  const { dict, records } = await loadIndex(`${base}${stem}.idx`)
  const mine = records.filter((r) => r.city === Number(city) && r.zone === Number(zone) && r.section === Number(section))
  const blobs = await Promise.all(mine.map((r) => fetchBytes(`${base}${stem}.pack`, [r.offset, r.length])))
  return { urns: await Promise.all(blobs.map(async (b) => parseBlob(await inflate(b), dict))), bytes: blobs.reduce((n, b) => n + b.length, 0), index }
}
