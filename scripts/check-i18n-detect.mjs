// Language detection cases (src/i18n.js detectLocale) against stubbed browser globals.
import assert from 'node:assert/strict'

const run = async ({ languages, search = '', stored = null }) => {
  const store = new Map(stored ? [['lang', stored]] : [])
  const urls = []
  Object.defineProperties(globalThis, {
    location: { value: { href: `http://localhost/brazil-audit/2026/maps${search}` }, configurable: true },
    navigator: { value: { languages }, configurable: true },
    history: { value: { state: null, replaceState: (_, __, url) => urls.push(String(url)) }, configurable: true },
    localStorage: { value: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) }, configurable: true },
  })
  const { detectLocale } = await import('../src/i18n.js')
  return { locale: detectLocale(), saved: store.get('lang'), url: urls[0] }
}

const cases = [
  [{ languages: ['pt-BR'] }, 'pt-BR'],
  [{ languages: ['pt-PT', 'en'] }, 'pt-BR'],
  [{ languages: ['pt'] }, 'pt-BR'],
  [{ languages: ['en-US'] }, 'en'],
  [{ languages: ['en-US', 'pt-BR'] }, 'en'],
  [{ languages: ['es-ES', 'pt-BR'] }, 'pt-BR'],
  [{ languages: ['es'] }, 'en'],
  [{ languages: ['fr-FR', 'fr'] }, 'en'],
  [{ languages: [] }, 'en'],
  [{ languages: ['en-US'], stored: 'pt-BR' }, 'pt-BR'],
  [{ languages: ['pt-BR'], stored: 'en' }, 'en'],
  [{ languages: ['pt-BR'], search: '?lang=en', stored: 'pt-BR' }, 'en'],
  [{ languages: ['en-US'], search: '?lang=pt-BR' }, 'pt-BR'],
  [{ languages: ['en-US'], search: '?lang=xx', stored: 'pt-BR' }, 'pt-BR'],
]
for (const [input, expected] of cases) {
  const { locale } = await run(input)
  assert.equal(locale, expected, JSON.stringify(input))
}
const query = await run({ languages: ['pt-BR'], search: '?office=3&lang=en' })
assert.deepEqual([query.saved, query.url], ['en', '/brazil-audit/2026/maps?office=3'].map((v, i) => (i ? `http://localhost${v}` : v)))
console.log(`i18n detection: ${cases.length + 1} cases ok`)
