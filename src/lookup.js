// Free-text lookup of a section or a municipality: "SP Zona 127 Seção 680", "sp / são paulo / 127 / 680", "rio branco ac", "127 680".
// Pure functions (the search box is components/SectionSearch.vue).
import { UFS } from './model.js'

const ZONE = new Set(['zona', 'zone', 'z'])
const SECTION = new Set(['secao', 'seção', 'section', 'sec', 's']) // i18n-ignore
const FILLER = new Set(['municipio', 'município', 'cidade', 'city', 'uf', 'estado', 'state']) // i18n-ignore

/** { uf, city, zone, section } of what was typed; zone and section as the 4-digit text the tables store, missing parts are ''. */
export function parseLookup(input) {
  const out = { uf: '', city: [], zone: '', section: '' }
  const tokens = String(input ?? '').toLowerCase().split(/[\s/,;|·]+/).filter(Boolean)
  let label = null
  const numbers = []
  for (const token of tokens) {
    if (ZONE.has(token) || SECTION.has(token)) label = ZONE.has(token) ? 'zone' : 'section'
    else if (/^\d+$/.test(token)) numbers.push([label ?? null, token.padStart(4, '0')]), (label = null)
    else if (!out.uf && UFS.includes(token)) out.uf = token
    else if (!FILLER.has(token)) out.city.push(token)
  }
  const rest = numbers.filter(([l]) => !l)
  for (const [l, n] of numbers.filter(([l]) => l)) out[l] = n
  for (const key of ['zone', 'section']) if (!out[key] && rest.length) out[key] = rest.shift()[1]
  return { ...out, city: out.city.join(' ') }
}
