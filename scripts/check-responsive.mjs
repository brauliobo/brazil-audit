// Responsive audit against a running Pages-like server (`node scripts/serve-pages.mjs 4190`), driving agent-browser:
//   node scripts/check-responsive.mjs [baseUrl] [--session=app] [--widths=320,375,768,1280]
// Fails when a view scrolls horizontally (outside its own scroll containers) at any width, or when, with the touch rules applied (the
// `(pointer: coarse)` block of the stylesheet is copied onto :root), a control is smaller than 44px (24px in dense contexts: tables, chips,
// legends, paragraphs) or a form control has a font below 16px (iOS zooms the page on focus).
import { execFileSync } from 'node:child_process'

const arg = (name, fallback) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback
const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://127.0.0.1:4190/brazil-audit'
const session = arg('session', 'app')
const widths = arg('widths', '320,375,768,1280').split(',').map(Number)
const ALL = [
  '2026/overview', '2026/maps', '2026/maps?scope=state&uf=sp', '2026/parliament?chamber=chamber', '2026/seats', '2026/seats?office=6&uf=sp', '2022/seats?office=7&uf=ac', '2018/seats?office=8', '2026/drill/sp', '2026/drill/sp/SÃO%20PAULO',
  '2026/analysis?state=rr', '2026/benford', '2018/benford?office=3&place=sp&digits=2', '2022-2/benford?unit=city', '2026/time/ac', '2026/sql', '2026/design', '2022/overview',
]
const ROUTES = arg('routes') ? ALL.filter((r) => r.includes(arg('routes'))) : ALL

const ab = (...args) => execFileSync('agent-browser', ['--session', session, ...args], { encoding: 'utf8' }).trim().split('\n').at(-1)
const evaluate = (js) => JSON.parse(JSON.parse(ab('eval', js)))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const READY = `(() => JSON.stringify(document.querySelectorAll('.panel, h1').length > 0 && !document.querySelector('.skeleton') && ![...document.querySelectorAll('.panel__badge')].some((m) => m.innerText === '…')))()`
const OVERFLOW = `(() => {
  const vw = document.documentElement.clientWidth
  const wide = [...document.querySelectorAll('body *')].filter((e) => {
    const r = e.getBoundingClientRect()
    return r.width > 0 && r.right > vw + 1 && !e.closest('.table-wrap, svg, .tabs') && getComputedStyle(e).position !== 'fixed'
  })
  const name = (e) => e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className ? '.' + e.className.split(' ')[0] : '')
  return JSON.stringify({ vw, scroll: document.documentElement.scrollWidth, header: Math.round(document.querySelector('.site-header').getBoundingClientRect().height), offenders: wide.slice(0, 4).map(name) })
})()`

const TOUCH = `(() => {
  const root = document.documentElement
  for (const sheet of document.styleSheets) for (const rule of sheet.cssRules) {
    if (rule.media?.mediaText.includes('pointer: coarse')) for (const r of rule.cssRules) if (r.selectorText === ':root') for (const p of r.style) root.style.setProperty(p, r.style.getPropertyValue(p))
  }
  const rem = parseFloat(getComputedStyle(root).fontSize)
  const hit = parseFloat(getComputedStyle(root).getPropertyValue('--size-hit-area')) * rem
  const dense = 'p, td, th, li, .chips, .legend, .breadcrumb, .panel__sql, .bars__row, .tooltip, .skip-link, label.switch, .site-footer, .chip'
  const bad = []
  for (const e of document.querySelectorAll('a, button, select, input:not([type=checkbox]), textarea, summary, [tabindex="0"]:not(main)')) {
    if (e.closest('svg, .map, .skip-link') || (e.tagName === 'A' && getComputedStyle(e).display === 'inline')) continue // inline text links are exempt (WCAG 2.5.8)
    const r = e.getBoundingClientRect()
    const min = e.closest(dense) ? 24 : hit
    if (r.width && r.height && (r.height < min - 1 || r.width < min - 1)) bad.push(e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className ? '.' + e.className.split(' ')[0] : '') + '[' + (e.innerText || e.getAttribute('aria-label') || '').trim().slice(0, 16) + '] ' + Math.round(r.width) + 'x' + Math.round(r.height))
  }
  const fonts = [...document.querySelectorAll('select, input:not([type=checkbox]), textarea')].filter((e) => parseFloat(getComputedStyle(e).fontSize) < 16).length
  return JSON.stringify({ bad: [...new Set(bad)].slice(0, 8), fonts })
})()`

let failures = 0
for (const width of widths) {
  ab('set', 'viewport', String(width), '800')
  for (const route of ROUTES) {
    ab('open', `${base}/${route}`)
    for (let i = 0; i < 300 && !evaluate(READY); i++) await sleep(300)
    const { vw, scroll, header, offenders } = evaluate(OVERFLOW)
    const touch = width <= 768 ? evaluate(TOUCH) : { bad: [], fonts: 0 }
    const problems = [scroll > vw + 1 && `scrollWidth ${scroll} > ${vw}: ${offenders.join(', ')}`, touch.bad.length && `small targets: ${touch.bad.join(', ')}`, touch.fonts && `${touch.fonts} form controls under 16px`].filter(Boolean)
    failures += problems.length > 0
    console.log(`${problems.length ? 'FAIL' : 'ok  '} ${String(width).padStart(4)}px header ${String(header).padStart(3)}px  ${route}${problems.length ? `  ${problems.join('; ')}` : ''}`)
  }
}
if (failures) { console.error(`${failures} view(s) failed`); process.exit(1) }
console.log('responsive: no overflow, touch targets and form fonts ok')
