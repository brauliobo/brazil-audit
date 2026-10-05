// Geometry and TSE/IBGE downloads for build-data.mjs: cached on disk (.cache/, git-ignored), throttled, deterministic.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const CACHE = '.cache'
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0 Safari/537.36'
const HEADERS = { 'user-agent': UA, referer: 'https://resultados.tse.jus.br/oficial/app/index.html' }
const IBGE = 'https://servicodados.ibge.gov.br/api/v3/malhas'
export const TSE_MUN = 'https://resultados.tse.jus.br/oficial/ele2026/6257/config/mun-e006257-cm.json'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Downloads `url` once into .cache/<name> (reruns read the file unless `fresh`: volatile result files) and returns its text; at most ~4 requests per second. */
export async function cached(name, url, { fresh = false } = {}) {
  const file = `${CACHE}/${name}`
  if (existsSync(file) && !fresh) return readFileSync(file, 'utf8')
  mkdirSync(file.slice(0, file.lastIndexOf('/')), { recursive: true })
  await sleep(250)
  const res = await fetch(url, { headers: HEADERS })
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  const body = await res.text()
  writeFileSync(file, body)
  return body
}

export const tseMunicipalities = async () => JSON.parse(await cached('tse-mun.json', TSE_MUN))

// ---- TopoJSON -> compact SVG paths ------------------------------------------------------------------------------------

function decodeArcs({ arcs, transform: { scale, translate } }) {
  return arcs.map((arc) => {
    let [x, y] = [0, 0]
    return arc.map(([dx, dy]) => [(x += dx) * scale[0] + translate[0], (y += dy) * scale[1] + translate[1]])
  })
}

const ringOf = (arcs, indexes) => indexes.flatMap((i, n) => {
  const pts = i < 0 ? [...arcs[~i]].reverse() : arcs[i]
  return n ? pts.slice(1) : pts
})

/** [{ id, polygons: [[ring, ...holes]] }] in lon/lat. */
export function polygonsOf(topology) {
  const arcs = decodeArcs(topology)
  const [object] = Object.values(topology.objects)
  return object.geometries.map((g) => {
    const polys = g.type === 'Polygon' ? [g.arcs] : g.arcs
    return { id: g.properties.codarea, polygons: polys.map((rings) => rings.map((r) => ringOf(arcs, r))) }
  })
}

const centroid = (ring) => [ring.reduce((t, p) => t + p[0], 0) / ring.length, ring.reduce((t, p) => t + p[1], 0) / ring.length]

function bounds(features) {
  const pts = features.flatMap((f) => f.polygons.flatMap((p) => p[0]))
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1])
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }
}

/** Equirectangular projection scaled by cos(latitude) so the shapes are not stretched; integer units, `width` wide. */
export function projection(b, width) {
  const cos = Math.cos(((b.y0 + b.y1) / 2) * Math.PI / 180)
  const k = width / ((b.x1 - b.x0) * cos)
  return { w: width, h: Math.round((b.y1 - b.y0) * k), at: ([lon, lat]) => [Math.round((lon - b.x0) * cos * k), Math.round((b.y1 - lat) * k)] }
}

const num = (n, i) => (i && n >= 0 ? ` ${n}` : `${n}`)

function ringPath(ring, at) {
  const pts = ring.map(at).filter((p, i, a) => !i || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1])
  if (pts.length < 3) return ''
  const deltas = pts.slice(1).flatMap((p, i) => [p[0] - pts[i][0], p[1] - pts[i][1]])
  return `M${pts[0][0]} ${pts[0][1]}l${deltas.map(num).join('')}z`
}

const pathOf = (f, at) => f.polygons.flatMap((rings) => rings.map((r) => ringPath(r, at))).join('')

/** `{ w, h, items: [[id, path]] }`: all items share one projection, so overlays (state borders) line up. */
export function toMap(layers, width, fixed) {
  const all = layers.flat()
  const proj = projection(fixed ?? bounds(all), width)
  return (features) => ({ w: proj.w, h: proj.h, items: features.map((f) => [f.id, pathOf(f, proj.at)]).filter((i) => i[1]) })
}

const topology = async (name, path) => JSON.parse(await cached(`ibge-${name}.json`, `${IBGE}/${path}&formato=application/json`))

// Brazil: fixed frame (mainland only), so the state file and the municipality file share one projection
const BRAZIL = { x0: -74, x1: -34, y0: -34, y1: 5.5 }
const keepIn = (features, b) => features.map((f) => ({ ...f, polygons: f.polygons.filter((p) => { const [x, y] = centroid(p[0]); return x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1 }) })).filter((f) => f.polygons.length)

/** Returns { uf, mun, states: { <uf>: map } } as plain objects ready to be written as JSON. */
export async function buildGeometry(codeToUf) {
  const national = toMap([], 1600, BRAZIL)
  const ufs = keepIn(polygonsOf(await topology('uf', 'paises/BR?qualidade=minima&intrarregiao=UF')), BRAZIL)
  const muns = keepIn(polygonsOf(await topology('mun', 'paises/BR?qualidade=minima&intrarregiao=municipio')), BRAZIL)
  const out = { uf: national(ufs.map((f) => ({ ...f, id: codeToUf[f.id] }))), mun: national(muns), states: {} }
  for (const [code, uf] of Object.entries(codeToUf)) {
    // the state's own (mainland) outline bounds its municipalities: island polygons fall outside it
    const b = bounds(ufs.filter((f) => f.id === code))
    const frame = { x0: b.x0 - 0.3, x1: b.x1 + 0.3, y0: b.y0 - 0.3, y1: b.y1 + 0.3 }
    const features = keepIn(polygonsOf(await topology(`mun-${uf}`, `estados/${code}?qualidade=intermediaria&intrarregiao=municipio`)), frame)
    out.states[uf] = toMap([features], 2000)(features)
  }
  return out
}
