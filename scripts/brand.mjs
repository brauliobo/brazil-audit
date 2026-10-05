// Regenerates every standalone brand file (they cannot read page CSS variables) from the brand tokens, so colours never drift:
// public/{favicon,logo-mark,logo,logo-mono}.svg, the PNG icons, favicon.ico, og-image.png and site.webmanifest.
//   npm run brand      (needs rsvg-convert and ImageMagick `convert` for the rasters)
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { toHex, token } from './tokens.mjs'

const hex = (name, mode = 'light') => toHex(token(name, mode))
const COLORS = {
  blue: hex('--brand-blue'), amber: hex('--brand-amber'), lens: hex('--brand-lens'), ink: hex('--color-slate-900'), snow: hex('--color-slate-200'),
  muted: hex('--color-slate-500'), 'muted-dark': hex('--color-slate-400'), 'page-dark': hex('--color-slate-950'),
}
const fill = (name) => readFileSync(`scripts/brand/${name}.svg`, 'utf8').replace(/\{([\w-]+)\}/g, (_, k) => COLORS[k] ?? (() => { throw new Error(`unknown brand colour ${k}`) })())
const write = (path, text) => writeFileSync(`public/${path}`, text)
const dir = mkdtempSync(join(tmpdir(), 'brand-'))
const png = (svg, out, size, height = size) => {
  writeFileSync(`${dir}/in.svg`, svg)
  execFileSync('rsvg-convert', ['-w', size, '-h', height, '-o', `public/${out}`, `${dir}/in.svg`])
}

write('logo-mark.svg', fill('mark'))
write('favicon.svg', fill('mark'))
write('logo.svg', fill('logo'))
write('logo-mono.svg', readFileSync('scripts/brand/logo-mono.svg', 'utf8'))
png(fill('icon-square'), 'apple-touch-icon.png', 180)
png(fill('icon-square'), 'icon-192.png', 192)
png(fill('icon-square'), 'icon-512.png', 512)
png(fill('icon-maskable'), 'icon-maskable-512.png', 512)
png(fill('og'), 'og-image.png', 1200, 630)
for (const s of [16, 32, 48]) { writeFileSync(`${dir}/in.svg`, fill('mark')); execFileSync('rsvg-convert', ['-w', s, '-h', s, '-o', `${dir}/f${s}.png`, `${dir}/in.svg`]) }
execFileSync('convert', [16, 32, 48].map((s) => `${dir}/f${s}.png`).concat('public/favicon.ico'))

const manifest = JSON.parse(readFileSync('public/site.webmanifest', 'utf8'))
Object.assign(manifest, { theme_color: COLORS.blue, background_color: hex('--surface-page') })
writeFileSync('public/site.webmanifest', `${JSON.stringify(manifest, null, 2)}\n`)
console.log('brand files regenerated from', COLORS)
