// Design-token lint: (1) no colour, font-family or raw px/rem/em size literals in src/ outside src/design/primitives.css (the db engine
// is exempt); (2) WCAG contrast of the semantic text/surface/border/accent/candidate/status pairs in light and dark.
//   npm run lint:tokens
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { contrast, token } from './tokens.mjs'

const walk = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]))
const files = [...walk('src').filter((f) => /\.(css|vue|js)$/.test(f) && !f.startsWith('src/db/') && f !== 'src/design/primitives.css'), 'index.html', 'vite.config.js']

const COLOR_FN = /\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(|\bcolor\(/
const HEX = /#[0-9a-fA-F]{3,8}\b/
const NAMED = /(color|background|fill|stroke|border[\w-]*|outline[\w-]*|stop-color|content)\s*[:=]\s*["']?(white|black|red|blue|green|gray|grey|orange|yellow|purple|silver|navy|teal|maroon|pink|brown)\b/
const FONT = /font(-family)?\s*:[^;{}]*\b(system-ui|sans-serif|serif|monospace|Menlo|Consolas|Roboto|Helvetica|Arial|Segoe)\b|['"`](system-ui|sans-serif|monospace|Menlo|Consolas)\b/
const SIZE_PROPS = /(^|[\s{;'"`])(font-size|line-height|letter-spacing|padding[\w-]*|margin[\w-]*|gap|row-gap|column-gap|inset[\w-]*|top|left|right|bottom|border[\w-]*|outline[\w-]*|box-shadow|text-shadow|z-index|width|height|min-width|min-height|max-width|max-height)\s*:\s*([^;{}]*)/g
const RAW_UNIT = /(^|[^\w.-])[-+]?\d*\.?\d+(px|rem|em|pt|vh|vw|vmin)\b/

const problems = []
for (const file of files) {
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    const at = `${file}:${i + 1}`
    const code = line.replace(/\/\*.*?\*\//g, '').replace(/^\s*\/\/.*$/, '')
    if (HEX.test(code) || COLOR_FN.test(code) || NAMED.test(code)) problems.push(`${at}: colour literal: ${code.trim().slice(0, 90)}`)
    if (/!important/.test(code)) problems.push(`${at}: !important: ${code.trim().slice(0, 90)}`)
    if (/@media\s*\(prefers-color-scheme|\[data-theme/.test(code) && file !== 'src/design/semantic.css') problems.push(`${at}: theme switching outside semantic.css: ${code.trim().slice(0, 90)}`)
    if (FONT.test(code)) problems.push(`${at}: font-family literal: ${code.trim().slice(0, 90)}`)
    for (const m of code.matchAll(SIZE_PROPS)) if (RAW_UNIT.test(m[3].replace(/var\([^)]*\)/g, ''))) problems.push(`${at}: raw size in ${m[2]}: ${m[3].trim().slice(0, 60)}`)
  })
}

// ---- contrast ----
const TEXT = 4.5, UI = 3
const PAIRS = [
  ...['--text-primary', '--text-secondary', '--text-muted'].flatMap((t) => ['--surface-page', '--surface-raised', '--surface-sunken'].map((s) => [t, s, TEXT, 'text'])),
  ...['--text-link', '--text-danger', '--text-warning', '--text-success'].flatMap((t) => ['--surface-page', '--surface-raised'].map((s) => [t, s, TEXT, 'text'])),
  ['--status-info', '--status-info-bg', TEXT, 'text'], ['--status-warning', '--status-warning-bg', TEXT, 'text'],
  ['--status-danger', '--status-danger-bg', TEXT, 'text'], ['--status-success', '--status-success-bg', TEXT, 'text'],
  ['--accent-contrast', '--accent', TEXT, 'text'], ['--accent-contrast', '--accent-hover', TEXT, 'text'], ['--text-link', '--accent-subtle', TEXT, 'text'],
  ['--text-primary', '--accent-subtle', TEXT, 'text'],
  ...['--surface-page', '--surface-raised'].flatMap((s) => [['--border-strong', s, UI, 'ui'], ['--border-focus', s, UI, 'ui'], ['--accent', s, UI, 'ui'],
    ['--candidate-pt', s, UI, 'graphic'], ['--candidate-pl', s, UI, 'graphic'], ['--chart-bar', s, UI, 'graphic'], ['--chart-highlight', s, UI, 'graphic'], ['--seq-margin', s, UI, 'graphic'], ['--seq-blank', s, UI, 'graphic']]),
  ['--text-primary', '--surface-inverse', 1, 'info'],
]
const CATEGORICAL = [...Array.from({ length: 16 }, (_, i) => `--cat-${i + 1}`), '--cat-n1', '--cat-n2', '--cat-n3']
const failures = []
const warnings = []
const rows = []
for (const mode of ['light', 'dark']) {
  for (const [fg, bg, min, kind] of PAIRS) {
    const ratio = contrast(token(fg, mode), token(bg, mode))
    rows.push(`${mode.padEnd(5)} ${kind.padEnd(7)} ${fg.padEnd(18)} on ${bg.padEnd(20)} ${ratio.toFixed(2).padStart(5)} (>= ${min})`)
    if (ratio < min) failures.push(`${mode} ${fg} on ${bg}: ${ratio.toFixed(2)} < ${min} (${kind})`)
  }
  for (const c of CATEGORICAL) {
    const ratio = contrast(token(c, mode), token('--surface-raised', mode))
    if (ratio < UI) warnings.push(`${mode} ${c} on --surface-raised: ${ratio.toFixed(2)} < ${UI}`)
  }
}

if (process.argv.includes('--verbose')) console.log(rows.join('\n'))
console.log(`literals: ${problems.length} problem(s) in ${files.length} files; contrast: ${rows.length} pairs checked, ${failures.length} failing`)
if (warnings.length) console.log(`categorical hues below 3:1 on the card surface (always backed by labels, tooltips and tables): ${warnings.length}${process.argv.includes('--verbose') ? `\n  ${warnings.join('\n  ')}` : ''}`)
for (const p of [...problems, ...failures]) console.log(`  ${p}`)
process.exit(problems.length || failures.length ? 1 : 0)
