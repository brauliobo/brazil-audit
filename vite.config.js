import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { load as loadYaml } from 'js-yaml'
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { ELECTIONS, HIDDEN_VIEWS, VIEWS_NAV } from './src/model.js'
import { toHex, token } from './scripts/tokens.mjs'

const base = process.env.BASE_PATH ?? '/brazil-audit/'
const keep = base.split('/').filter(Boolean).length // path segments that belong to the base (1 for /brazil-audit/)

// Pages serves files as they are, with no rewrites. Known routes get their own index.html copy (HTTP 200); every other
// path gets 404.html, which sends the visitor to the base index with the path in the query (spa-github-pages) where
// index.html restores the real URL before the app mounts.
const fallbackPage = `<!doctype html><meta charset="utf-8"><title>Auditoria eleitoral · Electoral audit</title>
<noscript><a href="${base}">Auditoria eleitoral · Electoral audit</a></noscript>
<script>var l = location; l.replace(l.protocol + '//' + l.host + l.pathname.split('/').slice(0, ${keep + 1}).join('/') + '/?/' +
  l.pathname.slice(1).split('/').slice(${keep}).join('/').replace(/&/g, '~and~') + (l.search ? '&' + l.search.slice(1).replace(/&/g, '~and~') : '') + l.hash)</script>
`

const staticRoutes = () => Object.keys(ELECTIONS).flatMap((e) => ['', ...VIEWS_NAV, ...HIDDEN_VIEWS].map((v) => `${e}/${v}`))

// `data/` (the shippable dump) lives at the repo root; dev serves it as-is, the build copies it into dist.
// theme-color metas come from the semantic surface token (index.html cannot read CSS variables)
const themeColors = () => ({
  name: 'theme-colors',
  transformIndexHtml: (html) => html.replaceAll('%THEME_LIGHT%', toHex(token('--surface-page', 'light'))).replaceAll('%THEME_DARK%', toHex(token('--surface-page', 'dark'))),
})

// src/locales/*.yaml become ES modules (the default export is the message tree)
const yamlModules = () => ({ name: 'yaml', transform: (code, id) => (id.endsWith('.yaml') ? { code: `export default ${JSON.stringify(loadYaml(code))}`, map: null } : null) })

const pages = () => ({
  name: 'pages',
  apply: 'build',
  closeBundle() {
    cpSync('data', 'dist/data', { recursive: true })
    const index = readFileSync('dist/index.html', 'utf8')
    for (const route of staticRoutes()) {
      mkdirSync(`dist/${route}`, { recursive: true })
      writeFileSync(`dist/${route}/index.html`, index)
    }
    writeFileSync('dist/404.html', fallbackPage)
    const site = loadEnv('production', '.', 'VITE_').VITE_SITE_URL
    const urls = staticRoutes().filter((r) => !HIDDEN_VIEWS.some((v) => r.endsWith(`/${v}`))).map((r) => `  <url><loc>${site}/${r}</loc></url>`)
    writeFileSync('dist/sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`)
    writeFileSync('dist/robots.txt', `User-agent: *\nAllow: /\nSitemap: ${site}/sitemap.xml\n`)
  },
})

export default defineConfig({
  base,
  plugins: [vue({ features: { vapor: true } }), yamlModules(), themeColors(), pages()],
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@electric-sql/pglite'] },
  build: { target: 'es2022', chunkSizeWarningLimit: 600 },
})
