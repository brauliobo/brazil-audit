// IBGE geometry shipped as compact SVG paths (see scripts/geo.mjs): { w, h, items: [[id, path]] }, loaded lazily.
import { store } from './data'

const BASE = import.meta.env.BASE_URL
const cache = new Map()

const fetchMap = (entry) => {
  if (!cache.has(entry.url)) cache.set(entry.url, fetch(`${BASE}data/${entry.url}`).then((r) => r.json()))
  return cache.get(entry.url)
}

/** kind: 'uf' (27 states), 'mun' (5,5k municipalities, same projection) or a state sigla (that state's municipalities). */
export const loadGeo = (kind) => {
  const { geo } = store.manifest
  return fetchMap(kind === 'uf' || kind === 'mun' ? geo[kind] : geo.states[kind])
}
