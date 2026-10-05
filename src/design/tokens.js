// JS access to design tokens, for the few places that cannot use CSS (canvas): resolves a token through a probe element, so
// light-dark(), the data-theme override and forced colours are all honoured. Never put colour or size values in JS instead.
import { ref } from 'vue'

/** Bumps whenever the effective theme can change (system scheme or the data-theme attribute); read it to redraw canvases. */
export const theme = ref(0)
const bump = () => theme.value++
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', bump)
new MutationObserver(bump).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

/** The computed value of a token for a CSS property, e.g. token('--chart-bar') or token('--font-sans', 'fontFamily'). */
export function token(name, property = 'color') {
  const probe = document.body.appendChild(document.createElement('span'))
  probe.style[property] = `var(${name})`
  const value = getComputedStyle(probe)[property]
  probe.remove()
  return value
}
