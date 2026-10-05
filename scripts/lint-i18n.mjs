// Checks the locale files and the code that uses them (run by `npm run lint:i18n` and by the Pages workflow):
//   1. pt-BR.yaml and en.yaml have the same keys and the same {placeholders}; plural keys come as `_one` + `_other`
//   2. every key used in code (t('a.b'), t(`a.${x}`), or a string that is a key) exists; every key is used
//   3. dynamic key families are declared below with their members, and each member must exist
//   4. no hard-coded user-visible text in templates (text, label/title/aria-label/placeholder/alt) or in scripts
// Add `// i18n-ignore` at the end of a line for a literal that looks like text but is not.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseSfc } from '@vue/compiler-sfc'
import { NodeTypes, parse as parseHtml } from '@vue/compiler-dom'
import { parse as parseJs, parseExpression } from '@babel/parser'
import pug from 'pug'
import { load as loadYaml } from 'js-yaml'
import { ELECTIONS, HIDDEN_VIEWS, THEMES, UFS, VIEWS_NAV } from '../src/model.js'
import { EXAMPLES, TABLES } from '../src/sqlExamples.js'
import { LOCALES } from '../src/i18n.js'

const SRC = 'src'
const errors = []
const fail = (where, message) => errors.push(`${where}: ${message}`)

// ---- locale files -----------------------------------------------------------------------------------------------------
const flatten = (node, prefix = '') => Object.entries(node).flatMap(([k, v]) => (typeof v === 'object' && v !== null ? flatten(v, `${prefix}${k}.`) : [[`${prefix}${k}`, v]]))
const load = (locale) => new Map(flatten(loadYaml(readFileSync(join(SRC, 'locales', `${locale}.yaml`), 'utf8'))))
const locales = Object.fromEntries(LOCALES.map((l) => [l, load(l)]))
const [source, ...others] = LOCALES
const placeholders = (text) => [...new Set([...String(text).matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort().join(',')
const PLURAL = /_(one|other)$/
const base = (key) => key.replace(PLURAL, '')

for (const [name, messages] of Object.entries(locales)) {
  for (const [key, value] of messages) {
    if (typeof value !== 'string' || !value.trim()) fail(`${name}.yaml ${key}`, 'must be a non-empty string')
    if (placeholders(value).includes('count') && !PLURAL.test(key)) fail(`${name}.yaml ${key}`, '{count} is only for plural keys (_one/_other); use {n}')
    if (PLURAL.test(key) && !messages.has(key.endsWith('_one') ? key.replace(/_one$/, '_other') : key.replace(/_other$/, '_one'))) fail(`${name}.yaml ${key}`, 'plural keys need both _one and _other')
  }
}
for (const other of others) {
  for (const key of locales[source].keys()) if (!locales[other].has(key)) fail(`${other}.yaml`, `missing key ${key}`)
  for (const key of locales[other].keys()) if (!locales[source].has(key)) fail(`${other}.yaml`, `key ${key} is not in ${source}.yaml`)
  for (const [key, value] of locales[source]) {
    const twin = locales[other].get(key)
    if (twin !== undefined && placeholders(twin) !== placeholders(value)) fail(`${other}.yaml ${key}`, `placeholders {${placeholders(twin)}} differ from ${source} {${placeholders(value)}}`)
  }
}
const defined = new Set([...locales[source].keys()].map(base))
const isNamespace = (key) => [...defined].some((k) => k.startsWith(`${key}.`))

// ---- dynamic key families: prefix -> member ids (each `prefix + id` must exist) --------------------------------------------
const officeIds = [...new Set(Object.values(ELECTIONS).flatMap((e) => e.offices))]
const FAMILIES = {
  'nav.': [...VIEWS_NAV, ...HIDDEN_VIEWS],
  'states.': UFS,
  'offices.': officeIds,
  'lang.': LOCALES,
  'theme.': THEMES,
  'maps.metric.': ['winner', 'share', 'margin', 'blank'],
  'drill.level.': ['state', 'city', 'zone', 'section'],
  'drill.levels.': ['state', 'city', 'zone', 'section'],
  'time.rank.': ['fast', 'regular', 'gap', 'diff'],
  'coverage.reasons.': ['not_totalized', 'negative', 'no_official_file', 'zone_files_disagree'],
  'sql.examples.': EXAMPLES.map((e) => e.id),
  'sql.tables.': TABLES,
  'design.type.': ['display', 'title800', 'title700', 'subtitle600', 'text500', 'base400', 'table300', 'caption200', 'note100'],
}
for (const [prefix, members] of Object.entries(FAMILIES)) for (const m of members) if (!defined.has(`${prefix}${m}`)) fail('families', `missing key ${prefix}${m}`)

// ---- usage and hard-coded text ----------------------------------------------------------------------------------------
const used = new Set()
const families = new Set()
const LETTERS = 'A-Za-zÀ-ÿ'
const WORD = new RegExp(`[${LETTERS}]{2,}`, 'g')
const ALLOWED_WORDS = new Set(['PGlite', 'Vue', 'Vapor', 'Enter', 'Escape', 'ms', 'px', 'KB', 'MB'])
const isWord = (w) => !ALLOWED_WORDS.has(w) && !/^[A-Z]{2,5}$/.test(w) // acronyms (SQL, TSE, PT, UF...) are not translated
const PROSE = new RegExp(`^[${LETTERS}][${LETTERS}0-9,.'’()%·:–?!-]*( [${LETTERS}0-9][${LETTERS}0-9,.'’()%·:–?!-]*)+$`)
const SQL = /\b(select|from|where|join|group by|order by|create|insert|truncate|delete|analyze|union|window|having|drop|cascade|limit|asc|desc|is not null|transaction)\b|\w\(/
const KEYLIKE = /^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9_-]+)+$/

function checkLiteral(value, where, inKeyCall = false) {
  if (inKeyCall) return
  if (defined.has(base(value))) { used.add(base(value)); return }
  if (KEYLIKE.test(value) && isNamespace(value.split('.')[0])) { fail(where, `unknown key "${value}"`); return }
  if (SQL.test(value) || /^(https?:|\/|\.|#|--|var\()/.test(value)) return
  const text = new RegExp(`[À-ÿ]`).test(value) || PROSE.test(value) || new RegExp(`^[A-Z][a-z]{3,}$`).test(value)
  if (text && [...value.matchAll(WORD)].some((m) => isWord(m[0]))) fail(where, `hard-coded text ${JSON.stringify(value)}`)
}

function keysOf(node, where) {
  if (!node) return
  if (node.type === 'StringLiteral') {
    used.add(base(node.value))
    if (!defined.has(base(node.value))) fail(where, `unknown key "${node.value}"`)
    return
  }
  if (node.type === 'TemplateLiteral') {
    const prefix = node.quasis[0].value.cooked
    if (!(prefix in FAMILIES)) fail(where, `dynamic key family "${prefix}" is not declared in scripts/lint-i18n.mjs`)
    else families.add(prefix)
    return
  }
  if (node.type === 'ConditionalExpression') { keysOf(node.consequent, where); keysOf(node.alternate, where) }
}

function walk(node, where, ignoredLines, inKeyCall = false) {
  if (!node || typeof node.type !== 'string') return
  if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 't') {
    keysOf(node.arguments[0], where)
    node.arguments.slice(1).forEach((a) => walk(a, where, ignoredLines))
    return
  }
  const ignored = ignoredLines.has(node.loc?.start.line)
  if (node.type === 'StringLiteral' && !ignored) checkLiteral(node.value, `${where}:${node.loc.start.line}`, inKeyCall)
  if (node.type === 'TemplateElement' && !ignored) checkLiteral(node.value.cooked.trim(), `${where}:${node.loc.start.line}`)
  if (node.type === 'ImportDeclaration' || node.type === 'ExportAllDeclaration') return
  for (const [k, child] of Object.entries(node)) {
    if (['loc', 'start', 'end', 'extra', 'leadingComments', 'trailingComments'].includes(k) || (k === 'key' && !node.computed) || (k === 'property' && !node.computed)) continue
    for (const c of Array.isArray(child) ? child : [child]) walk(c, where, ignoredLines)
  }
}

const ignoredLinesOf = (source) => new Set(source.split('\n').flatMap((l, i) => (l.includes('i18n-ignore') ? [i + 1] : [])))
const scanScript = (code, where) => {
  const ast = parseJs(code, { sourceType: 'module' })
  walk(ast.program, where, ignoredLinesOf(code))
}
const scanExpression = (code, where) => {
  try { walk(parseExpression(code), where, new Set()) } catch (e) { fail(where, `cannot parse expression ${JSON.stringify(code)}: ${e.message}`) }
}

const TEXT_ATTRS = new Set(['label', 'title', 'aria-label', 'placeholder', 'alt'])
const visibleText = (text) => text.replace(/\{\{[\s\S]*?\}\}/g, ' ')
const TECHNICAL = /^-*\w+([.-]+\w+)+$/ // file names and token names, e.g. og-image.png, --font-family-mono
const words = (text) => (TECHNICAL.test(text.trim()) ? [] : [...visibleText(text).matchAll(WORD)].map((m) => m[0]).filter(isWord))

function scanTemplate(node, where) {
  if (node.type === NodeTypes.TEXT && words(node.content).length) fail(where, `hard-coded text ${JSON.stringify(node.content.trim())}`)
  if (node.type === NodeTypes.INTERPOLATION) scanExpression(node.content.content, where)
  for (const p of node.props ?? []) {
    if (p.type === NodeTypes.ATTRIBUTE && TEXT_ATTRS.has(p.name) && p.value && words(p.value.content).length) fail(where, `hard-coded ${p.name} ${JSON.stringify(p.value.content)}`)
    if (p.type === NodeTypes.DIRECTIVE && p.exp) scanExpression(p.name === 'for' ? p.exp.content.split(/\s+(?:in|of)\s+/).at(-1) : p.exp.content, where)
  }
  for (const child of node.children ?? []) scanTemplate(child, where)
}

function scanVue(file) {
  const { descriptor } = parseSfc(readFileSync(file, 'utf8'), { filename: file })
  for (const block of [descriptor.script, descriptor.scriptSetup].filter(Boolean)) scanScript(block.content, file)
  const tpl = descriptor.template
  if (!tpl) return
  const html = tpl.lang === 'pug' ? pug.render(tpl.content, { doctype: 'html' }) : tpl.content
  scanTemplate(parseHtml(html), file)
}

const sources = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'locales' ? [] : sources(join(dir, e.name))) : [join(dir, e.name)]))
for (const file of sources(SRC)) {
  if (file.endsWith('.vue')) scanVue(file)
  else if (file.endsWith('.js')) scanScript(readFileSync(file, 'utf8'), file)
}
for (const prefix of Object.keys(FAMILIES)) if (!families.has(prefix) && !defined.has(prefix)) console.warn(`family ${prefix} is declared but not used by any t(\`${prefix}\${…}\`)`)

for (const key of defined) {
  const covered = used.has(key) || [...families].some((prefix) => key.startsWith(prefix) && FAMILIES[prefix].map(String).includes(key.slice(prefix.length)))
  if (!covered) fail('unused', `key ${key}`)
}

// ---- report -----------------------------------------------------------------------------------------------------------
const perNamespace = {}
for (const key of defined) perNamespace[key.split('.')[0]] = (perNamespace[key.split('.')[0]] ?? 0) + 1
console.log(`i18n: ${defined.size} keys in ${LOCALES.length} languages  ${Object.entries(perNamespace).map(([k, n]) => `${k}:${n}`).join(' ')}`)
if (errors.length) {
  console.error(errors.join('\n'))
  console.error(`\n${errors.length} i18n problem(s)`)
  process.exit(1)
}
console.log('i18n: ok')
