// Usability audit by ISO 9241-11 (usability = effectiveness, efficiency and satisfaction in a context of use), against a running
// Pages-like server (`node scripts/serve-pages.mjs 4190`), driving agent-browser as a first-time visitor on a desktop (or --width=375 phone):
//   node scripts/check-usability.mjs [baseUrl] [--session=ux] [--width=1280 --height=800] [--runs=3] [--json=report.json] [--sus=answers.json]
// Each task is a goal a visitor has, with a success check on what the page shows (not on the route alone):
//   effectiveness  completion (the goal state was reached within the time limit) and errors on the way (page errors, console errors, error notices);
//   efficiency     time on task (data loading included), interactions against the shortest path (clicks, keys, choices, and a scroll when
//                  the target is not on screen), and time-based efficiency = goals per minute (Tullis & Albert);
//   satisfaction   a machine cannot feel it. Proxies for what spoils it: errors, no feedback while waiting over 1 s (Nielsen: visibility of
//                  system status), and layout shift above 0.1 (CLS, web.dev). Real satisfaction needs people: pass their System Usability Scale
//                  answers (one array of ten 1-5 values per respondent) with --sus and the score joins the report.
// Fails when a task is not completed, is slower than its budget, takes more interactions than its shortest path, or a proxy fails.
import { readFileSync, writeFileSync } from 'node:fs'
import { arg, baseUrl, browser, sleep } from './lib/browser.mjs'

const base = baseUrl()
const { ab, evaluate } = browser(arg('session', 'ux'))
const runs = Number(arg('runs', 1))
const SLOW = 1000 // ms after which the visitor needs some sign that the page is working
const CLS = 0.1
const LANG = '?lang=pt-BR' // the tasks name controls as the Portuguese page labels them
const NAV = (view) => `nav.tabs a[href$='/${view}']`

// budget: ms the task may take; steps: interactions on the shortest path (a scroll counts when the target starts off screen)
const TASKS = [
  { id: 'result', goal: 'see who leads the national presidential result', start: '2026/overview', steps: 0, budget: 15000, see: '.panel .bars', done: `document.querySelectorAll('.panel .bars__row').length >= 2` },
  { id: 'election', goal: 'switch to the 2022 election', start: '2026/overview', steps: 1, budget: 15000, run: (u) => u.radio('2022'),
    done: `location.pathname.endsWith('/2022/overview') && document.querySelector('h1').innerText.includes('2022') && document.querySelectorAll('.panel .bars__row').length >= 2` },
  { id: 'state', goal: 'open the result of São Paulo from the overview', start: '2026/overview', steps: 3, budget: 20000, run: async (u) => { await u.click(NAV('drill')); await u.click(".table a[href*='/drill/sp']") },
    done: `location.pathname.endsWith('/drill/sp') && document.querySelectorAll('.bars__row').length >= 2` },
  { id: 'city', goal: 'open the first city of São Paulo', start: '2026/drill/sp', steps: 2, budget: 20000, run: (u) => u.click('main .table tbody a'),
    done: `/\\/drill\\/sp\\/[^/]+$/.test(location.pathname) && document.querySelectorAll('.bars__row').length >= 2` },
  { id: 'regions', goal: 'see the percentages of the candidates inside the map of the regions', start: '2026/maps', steps: 1, budget: 20000, run: (u) => u.radio('Por região'),
    done: `location.search.includes('scope=region') && document.querySelectorAll('.region').length === 5 && document.querySelectorAll('.region .map__mark').length >= 40` },
  { id: 'times', goal: 'see the voting pace of Acre', start: '2026/overview', steps: 2, budget: 30000, run: async (u) => { await u.click(NAV('time')); await u.choose('main select', 'ac') },
    done: `location.pathname.endsWith('/time/ac') && document.querySelectorAll('main .table tbody tr').length > 0` },
  { id: 'benford', goal: 'open the Benford analysis', start: '2026/overview', steps: 1, budget: 30000, run: (u) => u.click(NAV('benford')), done: `location.pathname.endsWith('/benford') && !!document.querySelector('.panel svg')` },
  { id: 'language', goal: 'read the site in English', start: '2026/overview', steps: 1, budget: 10000, run: (u) => u.radio('English'),
    done: `document.documentElement.lang === 'en' && document.querySelector('h1').innerText.startsWith('Overview')` },
  { id: 'theme', goal: 'switch to the dark theme', start: '2026/overview', steps: 1, budget: 10000, run: (u) => u.radio('Escuro'), done: `document.documentElement.dataset.theme === 'dark'` },
  { id: 'keyboard', goal: 'jump to the content with the keyboard only', start: '2026/overview', steps: 2, budget: 10000, run: async (u) => { await u.press('Tab'); await u.press('Enter') }, done: `document.activeElement.id === 'main'` },
  { id: 'lost', goal: 'recover from a mistyped address', start: '2026/nowhere', steps: 1, budget: 20000, run: (u) => u.click('main a'),
    done: `location.pathname.endsWith('/2026/overview') && document.querySelectorAll('.panel .bars__row').length >= 2` },
]

const js = JSON.stringify
const exists = (sel) => evaluate(`JSON.stringify(!!document.querySelector(${js(sel)}))`)
const visible = (sel) => evaluate(`(() => { const r = document.querySelector(${js(sel)}).getBoundingClientRect(); return JSON.stringify(r.top < innerHeight && r.bottom > 0 && r.left >= 0 && r.right <= innerWidth) })()`)

async function waitFor(sel, limit) {
  const end = Date.now() + limit
  while (!exists(sel)) {
    if (Date.now() > end) throw new Error(`"${sel}" never appeared`)
    await sleep(100)
  }
}

// What the visitor does; every interaction counts as a step, and so does the scroll needed to reach a target below the fold.
function actor(limit) {
  const u = { steps: 0 }
  const act = async (sel, ...cmd) => { await reach(sel); u.steps++; ab(...cmd) }
  const reach = async (sel) => {
    await waitFor(sel, limit)
    if (!visible(sel)) { u.steps++; ab('scrollintoview', sel); await settled() }
  }
  // the page scrolls smoothly: wait until it stops before the next interaction
  const settled = async () => { for (let y = -1; y !== (y = evaluate('JSON.stringify([scrollY, ...[...document.querySelectorAll(".tabs")].map((e) => e.scrollLeft)].join())')); ) await sleep(150) }
  Object.assign(u, {
    reach,
    click: (sel) => act(sel, 'click', sel),
    choose: (sel, value) => act(sel, 'select', sel, value),
    radio: (name) => { u.steps++; ab('find', 'role', 'radio', 'click', '--name', name) },
    press: (key) => { u.steps++; ab('press', key) },
  })
  return u
}

const WATCH = `window.__ux = { cls: 0, errors: 0 }
new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (!e.hadRecentInput) __ux.cls += e.value })).observe({ type: 'layout-shift', buffered: true })
__ux.loading = false; setInterval(() => { if (document.querySelector('.skeleton, .engine-status, progress')) __ux.loading = true }, 50)
addEventListener('error', () => __ux.errors++); addEventListener('unhandledrejection', () => __ux.errors++)
const ce = console.error; console.error = (...a) => { __ux.errors++; ce(...a) }`
const STATE = (done) => `JSON.stringify({ done: !!(${done}), loading: __ux.loading, errors: __ux.errors + document.querySelectorAll('.notice--danger, .engine-status--error').length, cls: __ux.cls })`

async function attempt(task) {
  const url = `${base}/${task.start}${LANG}`
  ab('open', url)
  evaluate(`(localStorage.clear(), JSON.stringify(true))`) // a first-time visitor: nothing remembered (language, theme, imported data)
  ab('open', url)
  evaluate(`(() => { ${WATCH}; return JSON.stringify(true) })()`)
  const u = actor(task.budget)
  const t0 = Date.now()
  let feedback = false, seen
  try {
    await task.run?.(u)
    if (task.see) await u.reach(task.see)
    while (true) {
      seen = evaluate(STATE(task.done))
      feedback ||= seen.loading
      if (seen.done || Date.now() - t0 > task.budget * 3) break
      await sleep(100)
    }
  } catch (e) {
    seen = { done: false, errors: 1, cls: 0, note: e.message }
  }
  const ms = Date.now() - t0
  return { completed: seen.done, ms, steps: u.steps, errors: seen.errors, cls: Math.round(seen.cls * 1000) / 1000, feedback: ms <= SLOW || feedback, note: seen.note }
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
async function measure(task) {
  const tries = []
  for (let i = 0; i < runs; i++) tries.push(await attempt(task))
  const worst = (k) => Math.max(...tries.map((r) => r[k]))
  const flags = (r) => [!r.completed && `not completed${r.note ? ` (${r.note})` : ''}`, r.ms > task.budget && `slower than ${task.budget / 1000}s`, r.steps > task.steps && `${r.steps} interactions, ${task.steps} needed`,
    r.errors && `${r.errors} errors`, !r.feedback && `${Math.round(r.ms / 1000)}s without feedback`, r.cls > CLS && `layout shift ${r.cls}`].filter(Boolean)
  const result = { id: task.id, goal: task.goal, completed: tries.every((r) => r.completed), ms: median(tries.map((r) => r.ms)), steps: worst('steps'), optimal: task.steps, errors: worst('errors'),
    cls: worst('cls'), feedback: tries.every((r) => r.feedback) }
  return { ...result, problems: [...new Set(tries.flatMap(flags))], satisfaction: [!result.errors, result.feedback, result.cls <= CLS].filter(Boolean).length / 3 }
}

const sus = (answers) => answers.map((a) => a.reduce((sum, x, i) => sum + (i % 2 ? 5 - x : x - 1), 0) * 2.5)
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length
const sec = (ms) => `${(ms / 1000).toFixed(1)}s`

ab('set', 'viewport', arg('width', '1280'), arg('height', '800'))
ab('open', `${base}/${LANG}`)
const results = []
for (const task of TASKS) {
  const r = await measure(task)
  results.push(r)
  console.log(`${r.problems.length ? 'FAIL' : 'ok  '} ${r.id.padEnd(9)} ${sec(r.ms).padStart(6)} ${String(r.steps).padStart(2)}/${r.optimal} steps  errors ${r.errors}  shift ${r.cls}  ${r.goal}${r.problems.length ? `  <- ${r.problems.join('; ')}` : ''}`)
}

const done = results.filter((r) => r.completed)
const report = {
  effectiveness: { completion: done.length / results.length, errorFree: results.filter((r) => !r.errors).length / results.length },
  efficiency: { meanTimeMs: Math.round(mean(done.map((r) => r.ms))), goalsPerMinute: Math.round(mean(done.map((r) => 60000 / r.ms)) * 10) / 10, relativeSteps: results.reduce((a, r) => a + r.optimal, 0) / Math.max(1, results.reduce((a, r) => a + r.steps, 0)) },
  satisfaction: { proxy: mean(results.map((r) => r.satisfaction)), ...(arg('sus') && { sus: mean(sus(JSON.parse(readFileSync(arg('sus'), 'utf8')))) }) },
  tasks: results,
}
const pct = (x) => `${Math.round(x * 100)}%`
console.log(`\neffectiveness  completion ${pct(report.effectiveness.completion)}, tasks without errors ${pct(report.effectiveness.errorFree)}`)
console.log(`efficiency     mean time ${sec(report.efficiency.meanTimeMs)}, ${report.efficiency.goalsPerMinute} goals/min, shortest path / steps taken ${pct(report.efficiency.relativeSteps)}`)
console.log(`satisfaction   proxy ${pct(report.satisfaction.proxy)} (errors, feedback, layout shift)${report.satisfaction.sus == null ? '; no SUS answers given' : `, SUS ${report.satisfaction.sus.toFixed(1)}/100`}`)
if (arg('json')) writeFileSync(arg('json'), JSON.stringify(report, null, 1))
const failed = results.filter((r) => r.problems.length).length
if (failed) { console.error(`${failed} task(s) failed`); process.exit(1) }
console.log('usability: every task completed within its budget, shortest path, no errors')
