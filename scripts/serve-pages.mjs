// Static server that behaves like GitHub Pages, to test the built site: files are served as they are (text types gzipped),
// a directory without trailing slash gets a 301, and any missing path answers 404.html with status 404 (no rewrites).
//   node scripts/serve-pages.mjs [port] [base]      (defaults: 4173, /brazil-audit/, serving ./dist)
import { createServer } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { gzipSync } from 'node:zlib'

const [port = 4173, base = '/brazil-audit/'] = process.argv.slice(2)
const ROOT = 'dist'
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.gz': 'application/gzip', '.data': 'application/octet-stream' }
const GZIPPED = /\.(html|js|css|json|svg)$/

const send = (res, status, body, type, extra = {}) => {
  const zip = GZIPPED.test(extra.path ?? '') || type.startsWith('text/html')
  const out = zip ? gzipSync(body) : body
  res.writeHead(status, { 'content-type': type, 'content-length': out.length, ...(zip && { 'content-encoding': 'gzip' }) })
  res.end(out)
}

createServer((req, res) => {
  const { pathname, search } = new URL(req.url, 'http://x')
  const path = decodeURIComponent(pathname)
  const file = normalize(join(ROOT, path.startsWith(base) ? path.slice(base.length) : '\0'))
  const found = path.startsWith(base) && !file.startsWith('..') && existsSync(file)
  if (found && statSync(file).isDirectory()) {
    if (!path.endsWith('/')) { res.writeHead(301, { location: `${pathname}/${search}` }); return res.end() }
    const index = join(file, 'index.html')
    if (existsSync(index)) return send(res, 200, readFileSync(index), TYPES['.html'])
  } else if (found) {
    return send(res, 200, readFileSync(file), TYPES[extname(file)] ?? 'application/octet-stream', { path: file })
  }
  send(res, 404, readFileSync(join(ROOT, '404.html')), TYPES['.html'])
}).listen(+port, '127.0.0.1', () => console.log(`serving ${ROOT} like GitHub Pages at http://127.0.0.1:${port}${base}`))
