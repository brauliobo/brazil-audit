// Responsive audit against a running Pages-like server (`node scripts/serve-pages.mjs 4190`), driving agent-browser:
//   node scripts/check-responsive.mjs [baseUrl] [--session=app] [--widths=320,375,768,1280]
// Fails when a view scrolls horizontally (outside its own scroll containers) at any width.
import { execFileSync } from 'node:child_process'

const arg = (name, fallback) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback
const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://127.0.0.1:4190/brazil-audit'
const session = arg('session', 'app')
const widths = arg('widths', '320,375,768,1280').split(',').map(Number)
const ROUTES = [
  '2026/overview', '2026/maps', '2026/maps?scope=state&uf=sp', '2026/parliament?chamber=chamber', '2026/drill/sp', '2026/drill/sp/SÃO%20PAULO',
  '2026/analysis?state=rr', '2026/time/ac', '2026/sql', '2026/design', '2022/overview',
]

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

let failures = 0
for (const width of widths) {
  ab('set', 'viewport', String(width), '800')
  for (const route of ROUTES) {
    ab('open', `${base}/${route}`)
    for (let i = 0; i < 300 && !evaluate(READY); i++) await sleep(300)
    const { vw, scroll, header, offenders } = evaluate(OVERFLOW)
    const bad = scroll > vw + 1 // sub-pixel rounding
    failures += bad
    console.log(`${bad ? 'FAIL' : 'ok  '} ${String(width).padStart(4)}px header ${String(header).padStart(3)}px  ${route}${bad ? `  scrollWidth ${scroll} > ${vw}: ${offenders.join(', ')}` : ''}`)
  }
}
if (failures) { console.error(`${failures} view(s) scroll horizontally`); process.exit(1) }
console.log('responsive: no horizontal overflow')
