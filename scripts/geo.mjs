// Geometry and TSE/IBGE downloads for build-data.mjs: cached on disk (.cache/, git-ignored), throttled, deterministic.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'

const CACHE = '.cache'
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0 Safari/537.36'
const HEADERS = { 'user-agent': UA, referer: 'https://resultados.tse.jus.br/oficial/app/index.html' }
const IBGE = 'https://servicodados.ibge.gov.br/api/v3/malhas'
export const TSE_MUN = 'https://resultados.tse.jus.br/oficial/ele2026/6257/config/mun-e006257-cm.json'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Downloads `url` once into .cache/<name> (reruns read the file unless `fresh` or older than `maxAgeHours`: volatile result files) and returns its text; at most ~4 requests per second. */
export async function cached(name, url, { fresh = false, maxAgeHours = Infinity } = {}) {
  const file = `${CACHE}/${name}`
  if (existsSync(file) && !fresh && (Date.now() - statSync(file).mtimeMs) / 36e5 < maxAgeHours) return readFileSync(file, 'utf8')
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

// Douglas-Peucker on one arc (a border shared by two neighbours, so both sides stay consistent), tolerance in degrees
function simplify(points, tolerance) {
  const last = points.length - 1
  if (last > 3 && points[0][0] === points[last][0] && points[0][1] === points[last][1]) {
    // a closed ring in one arc: split it at the point farthest from its start so the chord is not degenerate
    const mid = points.reduce((best, p, i) => (Math.hypot(p[0] - points[0][0], p[1] - points[0][1]) > Math.hypot(points[best][0] - points[0][0], points[best][1] - points[0][1]) ? i : best), 0)
    return [...simplify(points.slice(0, mid + 1), tolerance), ...simplify(points.slice(mid), tolerance).slice(1)]
  }
  const keep = new Uint8Array(points.length)
  keep[0] = keep[points.length - 1] = 1
  const stack = [[0, points.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()
    const [ax, ay, bx, by] = [...points[a], ...points[b]]
    const len = Math.hypot(bx - ax, by - ay) || 1
    let [far, at] = [0, -1]
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((by - ay) * (points[i][0] - ax) - (bx - ax) * (points[i][1] - ay)) / len
      if (d > far) [far, at] = [d, i]
    }
    if (far > tolerance) { keep[at] = 1; stack.push([a, at], [at, b]) }
  }
  return points.filter((_, i) => keep[i])
}

function decodeArcs({ arcs, transform: { scale, translate } }, tolerance) {
  return arcs.map((arc) => {
    let [x, y] = [0, 0]
    const points = arc.map(([dx, dy]) => [(x += dx) * scale[0] + translate[0], (y += dy) * scale[1] + translate[1]])
    // small arcs (islands, tiny municipalities) are simplified relative to their own size so they never collapse
    const extent = Math.max(...points.map((p) => p[0])) - Math.min(...points.map((p) => p[0])) + Math.max(...points.map((p) => p[1])) - Math.min(...points.map((p) => p[1]))
    return simplify(points, Math.min(tolerance, extent / 12))
  })
}

const ringOf = (arcs, indexes) => indexes.flatMap((i, n) => {
  const pts = i < 0 ? [...arcs[~i]].reverse() : arcs[i]
  return n ? pts.slice(1) : pts
})

/** [{ id, polygons: [[ring, ...holes]] }] in lon/lat. */
export function polygonsOf(topology, tolerance) {
  const arcs = decodeArcs(topology, tolerance)
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

// an outer ring that collapses to fewer than 3 grid points (a tiny municipality) stays visible as a 2-unit square
function ringPath(ring, at, outer = true) {
  const pts = ring.map(at).filter((p, i, a) => !i || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1])
  if (pts.length < 3) return outer ? `M${pts[0][0]} ${pts[0][1]}h2v2h-2z` : ''
  const deltas = pts.slice(1).flatMap((p, i) => [p[0] - pts[i][0], p[1] - pts[i][1]])
  return `M${pts[0][0]} ${pts[0][1]}l${deltas.map(num).join('')}z`
}

const pathOf = (f, at) => f.polygons.flatMap((rings) => rings.map((r, i) => ringPath(r, at, i === 0))).join('')

/** `{ w, h, items: [[id, path]] }`: all items share one projection, so overlays (state borders) line up. */
export function toMap(layers, width, fixed) {
  const all = layers.flat()
  const proj = projection(fixed ?? bounds(all), width)
  return (features) => ({ w: proj.w, h: proj.h, items: features.map((f) => [f.id, pathOf(f, proj.at)]).filter((i) => i[1]) })
}

const topology = async (path) => JSON.parse(await cached(`ibge-${path.replace(/\W+/g, '_')}.json`, `${IBGE}/${path}&formato=application/json`))

// Approximate borders on purpose: IBGE's coarsest meshes, drawn on integer grids this wide (state files are viewed at ~600 px)
const NATIONAL_WIDTH = 1100
const STATE_WIDTH = 1400
const STATE_QUALITY = 'minima'
const NATIONAL_TOLERANCE = 0.03 // Douglas-Peucker tolerance in degrees (0.03 degrees is about 1 unit of the national grid)
const STATE_TOLERANCE = 0.004

// Brazil: fixed frame (mainland only), so the state file and the municipality file share one projection
const BRAZIL = { x0: -74, x1: -34, y0: -34, y1: 5.5 }
const keepIn = (features, b) => features.map((f) => ({ ...f, polygons: f.polygons.filter((p) => { const [x, y] = centroid(p[0]); return x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1 }) })).filter((f) => f.polygons.length)

const NORONHA = { id: '2605459', uf: '26', label: 'Fernando de Noronha (PE)' }
const INSET_WIDTH = 90

/** The oceanic island of Fernando de Noronha, clipped from the mainland frame, drawn magnified in the bottom-right corner. */
function addInset(map, polygons, items) {
  const proj = projection(bounds([{ polygons }]), INSET_WIDTH)
  const [ox, oy] = [map.w - INSET_WIDTH - 24, map.h - proj.h - 48]
  const path = polygons.flatMap((rings) => rings.map((r, i) => ringPath(r, (p) => { const [x, y] = proj.at(p); return [x + ox, y + oy] }, i === 0))).join('')
  for (const id of Object.keys(items)) {
    const item = map.items.find((i) => i[0] === id)
    if (item) item[1] += path
    else map.items.push([id, path])
  }
  map.labels = [{ x: map.w - 8, y: oy + proj.h + 16, text: NORONHA.label }]
}

/** Returns { uf, mun, states: { <uf>: map } } as plain objects ready to be written as JSON. */
export async function buildGeometry(codeToUf) {
  const national = toMap([], NATIONAL_WIDTH, BRAZIL)
  const allUfs = polygonsOf(await topology('paises/BR?qualidade=minima&intrarregiao=UF'), NATIONAL_TOLERANCE)
  const allMuns = polygonsOf(await topology('paises/BR?qualidade=minima&intrarregiao=municipio'), NATIONAL_TOLERANCE)
  const [ufs, muns] = [keepIn(allUfs, BRAZIL), keepIn(allMuns, BRAZIL)]
  const out = { uf: national(ufs.map((f) => ({ ...f, id: codeToUf[f.id] }))), mun: national(muns), states: {} }
  // the coarse meshes reduce the island to a point: take its outline from the single-municipality mesh
  const island = polygonsOf(await topology(`municipios/${NORONHA.id}?qualidade=maxima`), 0.0005)[0].polygons
  addInset(out.uf, island, { [codeToUf[NORONHA.uf]]: 1 })
  addInset(out.mun, island, { [NORONHA.id]: 1 })
  for (const [code, uf] of Object.entries(codeToUf)) {
    // the state's own (mainland) outline bounds its municipalities: island polygons fall outside it
    const b = bounds(ufs.filter((f) => f.id === code))
    const frame = { x0: b.x0 - 0.3, x1: b.x1 + 0.3, y0: b.y0 - 0.3, y1: b.y1 + 0.3 }
    const features = keepIn(polygonsOf(await topology(`estados/${code}?qualidade=${STATE_QUALITY}&intrarregiao=municipio`), STATE_TOLERANCE), frame)
    out.states[uf] = toMap([features], STATE_WIDTH)(features)
  }
  return out
}
