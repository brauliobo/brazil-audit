// Translations: one YAML file per language in src/locales (pt-BR is the source, en follows its keys; `npm run lint:i18n` enforces it).
// t('ns.key', { name }) interpolates {name}; with { count } the key is looked up as `key_one` / `key_other` (Intl.PluralRules) and {count} is
// formatted for the locale. A missing key is logged and shown as the key itself, never replaced by another language.
import { computed, shallowRef, watchEffect } from 'vue'

export const LOCALES = ['pt-BR', 'en']
const STORAGE_KEY = 'lang'
const loaders = { 'pt-BR': () => import('./locales/pt-BR.yaml'), en: () => import('./locales/en.yaml') }

const messages = shallowRef({})
export const locale = shallowRef(null)
const plurals = computed(() => new Intl.PluralRules(locale.value))
const counts = computed(() => new Intl.NumberFormat(locale.value))

const lookup = (key) => key.split('.').reduce((node, part) => node?.[part], messages.value)

export function t(key, params = {}) {
  const text = lookup(params.count == null ? key : `${key}_${plurals.value.select(params.count)}`)
  if (typeof text !== 'string') {
    console.error(`i18n: missing key "${key}" for ${locale.value}`)
    return key
  }
  return text.replace(/\{(\w+)\}/g, (_, name) => (name === 'count' ? counts.value.format(params.count) : (params[name] ?? (console.error(`i18n: "${key}" needs {${name}}`), `{${name}}`))))
}

// ?lang=en wins and is remembered, then the remembered choice, then the first browser language that is pt or en (default en)
export function detectLocale() {
  const url = new URL(location.href)
  const asked = LOCALES.find((l) => l.toLowerCase() === url.searchParams.get('lang')?.toLowerCase())
  if (asked) {
    localStorage.setItem(STORAGE_KEY, asked)
    url.searchParams.delete('lang')
    history.replaceState(history.state, '', url)
    return asked
  }
  const stored = localStorage.getItem(STORAGE_KEY)
  if (LOCALES.includes(stored)) return stored
  return /^pt/i.test(navigator.languages.find((l) => /^(pt|en)/i.test(l)) ?? '') ? 'pt-BR' : 'en'
}

async function setLocale(next) {
  messages.value = (await loaders[next]()).default
  locale.value = next
}

/** The language switch: changes the language without a reload and remembers the choice. */
export async function chooseLocale(next) {
  await setLocale(next)
  localStorage.setItem(STORAGE_KEY, next)
}

/** Loads the detected language; the app mounts after it resolves. */
export async function initLocale() {
  await setLocale(detectLocale())
  watchEffect(() => {
    document.documentElement.lang = locale.value
    document.querySelector('meta[name="description"]').content = t('app.description')
  })
}
