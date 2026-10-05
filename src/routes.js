// Pure route parsing (no browser globals): `<base>/<election>/<view>/<arg>/...?<query>`. Links without an election (/time/sp) resolve to
// the latest one; an election-like first segment that is not configured, or an unknown view, is `notFound`.
import { DEFAULT_ELECTION, ELECTIONS, HIDDEN_VIEWS, VIEWS_NAV } from './model.js'

export function parseRoute(base, path, search) {
  const segments = path.slice(base.length).split('/').filter(Boolean).map(decodeURIComponent)
  const [election, ...rest] = segments[0] in ELECTIONS ? segments : [DEFAULT_ELECTION, ...segments]
  const [view = 'overview', ...args] = rest
  const unknownElection = /^\d{4}(-\d)?$/.test(segments[0] ?? '') && !(segments[0] in ELECTIONS)
  return { election, view, args, params: new URLSearchParams(search), notFound: unknownElection || ![...VIEWS_NAV, ...HIDDEN_VIEWS].includes(view) }
}
