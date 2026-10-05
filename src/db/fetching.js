// Cache API backed fetch for the compressed assets (engine wasm/vfs and data parts): the second visit never hits the network.
/** `version` busts the cache entry when the asset changes (it is stored as a query on the key). */
export async function cachedFetch(url, version) {
  const cache = await caches.open('auditoria-assets-v1')
  const key = `${url}?v=${version}`
  const hit = await cache.match(key)
  if (hit) return hit
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  cache.put(key, res.clone()).catch(console.warn)
  return res
}

/**
 * Inflates a `.gz` response, reporting the bytes read from the body. Some servers (vite dev) answer `.gz` files with
 * Content-Encoding: gzip, in which case the browser has already inflated the body.
 */
export function gunzip(res, onBytes = () => {}) {
  let n = 0
  const counted = res.body.pipeThrough(new TransformStream({ transform: (c, ctl) => { onBytes((n += c.length)); ctl.enqueue(c) } }))
  return res.headers.get('content-encoding') ? counted : counted.pipeThrough(new DecompressionStream('gzip'))
}
