// Resolves the design tokens (src/design/*.css, the first :root block of each layer) to concrete colours per theme, so scripts can
// check contrast and the build can derive theme-color / manifest colours from the tokens instead of repeating hex values.
import { readFileSync } from 'node:fs'

const FILES = ['primitives', 'semantic', 'components']
const declarations = Object.assign({}, ...FILES.map((f) => {
  const text = readFileSync(`src/design/${f}.css`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const block = /:root\s*\{([\s\S]*?)\n\}/.exec(text)[1]
  return Object.fromEntries([...block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(([, k, v]) => [k, v.trim()]))
}))

// split "a, b(c, d), e" on top-level commas
const args = (s) => {
  const out = []
  let [depth, cur] = [0, '']
  for (const ch of s) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && !depth) { out.push(cur.trim()); cur = '' } else cur += ch
  }
  return [...out, cur.trim()]
}

function oklabOf(color) {
  const m = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)$/.exec(color)
  if (!m) throw new Error(`unsupported colour: ${color}`)
  const [L, C, h] = [+m[1], +m[2], (+m[3] * Math.PI) / 180]
  return { L, a: C * Math.cos(h), b: C * Math.sin(h), alpha: m[4] == null ? 1 : +m[4] }
}

export function srgbOf({ L, a, b }) {
  const [l, m, s] = [L + 0.3963377774 * a + 0.2158037573 * b, L - 0.1055613458 * a - 0.0638541728 * b, L - 0.0894841775 * a - 1.291485548 * b].map((x) => x ** 3)
  const lin = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s]
  return lin.map((x) => Math.min(1, Math.max(0, x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055)))
}

export const toHex = (lab) => `#${srgbOf(lab).map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('')}`

/** The OKLab colour of a token (or colour expression) in a theme: follows var(), light-dark() and color-mix(in oklab, a p%, b). */
export function resolve(value, mode, depth = 0) {
  if (depth > 20) throw new Error(`token cycle at ${value}`)
  let v = value.trim()
  const ref = /^var\((--[\w-]+)\)$/.exec(v)
  if (ref) return resolve(declarations[ref[1]] ?? (() => { throw new Error(`unknown token ${ref[1]}`) })(), mode, depth + 1)
  const ld = /^light-dark\((.*)\)$/s.exec(v)
  if (ld) return resolve(args(ld[1])[mode === 'dark' ? 1 : 0], mode, depth + 1)
  const mix = /^color-mix\(in oklab,(.*)\)$/s.exec(v)
  if (mix) {
    const [first, second] = args(mix[1]).map((p) => /^(.*?)(?:\s+([\d.]+)%)?$/s.exec(p))
    const [c1, c2] = [resolve(first[1], mode, depth + 1), resolve(second[1], mode, depth + 1)]
    const p = (first[2] ?? 100 - (second[2] ?? 50)) / 100
    return { L: c1.L * p + c2.L * (1 - p), a: c1.a * p + c2.a * (1 - p), b: c1.b * p + c2.b * (1 - p), alpha: 1 }
  }
  return oklabOf(v)
}

export const token = (name, mode) => resolve(declarations[name] ?? (() => { throw new Error(`unknown token ${name}`) })(), mode)
export const tokenNames = () => Object.keys(declarations)

const luminance = (lab) => { const [r, g, b] = srgbOf(lab).map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
export const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
