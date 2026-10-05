// Hash routing: #/<election>/<view>/<arg>/<arg>…?<query>
import { computed, ref } from 'vue'

const hash = ref(location.hash)
addEventListener('hashchange', () => (hash.value = location.hash))

export const route = computed(() => {
  const [path, qs = ''] = hash.value.replace(/^#\/?/, '').split('?')
  const [election = '2022', view = 'overview', ...args] = path.split('/').filter(Boolean).map(decodeURIComponent)
  return { election, view, args, params: new URLSearchParams(qs) }
})

export const href = (election, view, args = [], params = {}) => {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString()
  return `#/${election}/${view}${args.map((a) => `/${encodeURIComponent(a)}`).join('')}${qs ? `?${qs}` : ''}`
}

export const go = (url) => { location.hash = url }
/** Replaces one query parameter in the current route without adding a history entry. */
export const setParam = (name, value) => {
  const { election, view, args, params } = route.value
  const next = Object.fromEntries(params)
  if (value == null || value === '') delete next[name]
  else next[name] = value
  history.replaceState(null, '', href(election, view, args, next))
  hash.value = location.hash
}
