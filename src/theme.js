// Theme choice: 'system' follows prefers-color-scheme, 'light' / 'dark' set data-theme on <html> (the design tokens do the rest).
// index.html applies the stored choice before the first paint; the theme-color metas follow the choice here.
import { shallowRef, watchEffect } from 'vue'
import { THEMES } from './model'
const STORAGE_KEY = 'theme'

export const theme = shallowRef(THEMES.includes(localStorage.getItem(STORAGE_KEY)) ? localStorage.getItem(STORAGE_KEY) : 'system')
export const setTheme = (next) => {
  theme.value = next
  localStorage.setItem(STORAGE_KEY, next)
}

// an explicit choice replaces the two media-conditional theme-color metas by one colour; `system` restores them
const metas = [...document.querySelectorAll('meta[name="theme-color"]')]
const apply = (choice) => {
  for (const m of metas) {
    m.media = choice === 'system' ? `(prefers-color-scheme: ${m.dataset.scheme})` : ''
    m.content = m.dataset[choice === 'system' ? m.dataset.scheme : choice]
  }
}

watchEffect(() => {
  const choice = theme.value
  if (choice === 'system') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = choice
  apply(choice)
})
