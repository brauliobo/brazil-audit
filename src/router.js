// History API router under the Vite base: <base>/<election>/<view>/<arg>/<arg>?<query>. Identity lives in the path,
// every other state (office, metric, cand, scope, sort, page, q...) in the query string. Links are plain <a href>s built by
// href(); one delegated click handler turns same-origin clicks into client navigation.
import { computed, nextTick, ref } from 'vue'
import { DEFAULT_ELECTION, ELECTIONS, VIEW_LABELS } from './model'

const BASE = import.meta.env.BASE_URL // '/brazil-audit/' on Pages, '/' in dev or on a custom domain
const url = ref({ path: location.pathname, search: location.search })

const parse = (path, search) => {
  const segments = path.slice(BASE.length).split('/').filter(Boolean).map(decodeURIComponent)
  // links without an election (/time/sp) resolve to the latest one
  const [election, ...rest] = segments[0] in ELECTIONS ? segments : [DEFAULT_ELECTION, ...segments]
  const [view = 'overview', ...args] = rest
  return { election, view, args, params: new URLSearchParams(search) }
}

export const route = computed(() => parse(url.value.path, url.value.search))

export const href = (election, view, args = [], params = {}) => {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString()
  return `${BASE}${[election, view, ...args].map(encodeURIComponent).join('/')}${qs ? `?${qs}` : ''}`
}

const canonical = ({ election, view, args, params }) => href(election, view, args, Object.fromEntries(params))
const here = () => location.pathname + location.search
const sync = () => (url.value = { path: location.pathname, search: location.search })

// ---- scroll, title and focus ------------------------------------------------------------------------------------------
history.scrollRestoration = 'manual'
const scrolls = new Map() // history entry key -> scrollY
let key = 0

function arrive(restore) {
  const { election, view } = route.value
  document.title = `${VIEW_LABELS[view] ?? view} · ${ELECTIONS[election].label} · Auditoria eleitoral`
  nextTick(() => requestAnimationFrame(() => {
    scrollTo({ top: restore ?? 0, behavior: 'instant' })
    if (restore == null) { const h = document.querySelector('main h1'); if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }) } }
  }))
}

/** Client navigation to a path built with href(). */
export function go(to, { replace = false } = {}) {
  scrolls.set(history.state?.key ?? 0, scrollY)
  history[replace ? 'replaceState' : 'pushState']({ key: replace ? (history.state?.key ?? 0) : ++key }, '', to)
  sync()
  arrive()
}

/** Replaces one query parameter of the current route without adding a history entry. */
export function setParam(name, value) {
  const { election, view, args, params } = route.value
  const next = Object.fromEntries(params)
  if (value == null || value === '') delete next[name]
  else next[name] = value
  history.replaceState(history.state, '', href(election, view, args, next))
  sync()
}

// Same-origin clicks on anchors inside the base navigate in place; modified clicks, targets, downloads, other origins and
// hash-only jumps keep their native behaviour (open in new tab, copy link, in-page anchors).
function onClick(e) {
  const a = e.target.closest?.('a[href]')
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
  if ((a.target && a.target !== '_self') || a.hasAttribute('download')) return
  const to = new URL(a.href)
  if (to.origin !== location.origin || !to.pathname.startsWith(BASE)) return
  if (to.pathname + to.search === here() && to.hash) return
  e.preventDefault()
  go(to.pathname + to.search + to.hash)
}

function onPop() {
  const [path, search] = [location.pathname, location.search]
  if (path === url.value.path && search === url.value.search) return // a hash-only change (in-page anchor)
  sync()
  arrive(scrolls.get(history.state?.key ?? 0) ?? 0)
}

// Links shared before the move to real paths looked like #/2026/maps?scope=uf.
const legacy = (hash) => {
  const [path, search = ''] = hash.slice(1).split('?')
  return canonical(parse(BASE + path.replace(/^\//, ''), search ? `?${search}` : ''))
}

export function startRouter() {
  const to = location.hash.startsWith('#/') ? legacy(location.hash) : canonical(route.value)
  history.replaceState({ key }, '', to)
  sync()
  document.addEventListener('click', onClick)
  addEventListener('popstate', onPop)
  addEventListener('scroll', () => scrolls.set(history.state?.key ?? 0, scrollY), { passive: true })
  arrive(0)
}
