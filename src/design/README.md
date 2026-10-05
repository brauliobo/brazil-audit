# Design system

One source of truth in plain CSS custom properties, three layers plus a base, imported in this order by `index.css`:

| File | Layer | Contains | Used by |
|---|---|---|---|
| `primitives.css` | 1. primitives | raw values with no meaning: colour scales (OKLCH), font families/sizes/weights/line heights, spacing (4 px base), radii, border widths, shadows, z-index, durations, sizes, breakpoints list | only `semantic.css` |
| `semantic.css` | 2. semantic | meaning, theme aware: surfaces, text, borders, focus, accent, status, candidate identity, brand, data-viz (chart, map, sequential, categorical `--cat-N`), semantic spacing/typography/shape, motion; the **only** place for light/dark, breakpoints, reduced motion and forced colors | `components.css`, `base.css`, JS helper |
| `components.css` | 3. component | tokens defined only from semantic tokens (`--button-*`, `--field-*`, `--panel-*`, `--table-*`, `--tooltip-*`, `--legend-*`, `--bar-*`, `--map-*`, `--hemicycle-*`...) and the component rules | Vue components |
| `base.css` | base | reset, element defaults, utilities (`.stack`, `.cluster`, `.muted`, `.num`, `.visually-hidden`) built on tokens | everything |

Naming: `--<group>-<role>` (`--color-slate-700`, `--text-primary`, `--button-primary-bg`). Components use only component or semantic tokens.

## Theming

Colour tokens are written once with `light-dark(<light>, <dark>)`. `<html>` has `color-scheme: light dark` (follows `prefers-color-scheme`);
`data-theme="light|dark"` on any element forces that scheme for it and its descendants (the theme switcher sets it on `<html>`; previews on `/design`
set it on a box). No second copy of the dark values exists. `@media (prefers-reduced-motion)` zeroes the motion tokens, `@media (forced-colors)`
swaps borders/focus/map strokes for system colours, `@media (pointer: coarse)` raises the control height to the hit-area size.

## Adding a token

1. A raw value: add it to `primitives.css` (never reference it from components).
2. A meaning: add `--<group>-<role>: light-dark(var(--primitive), var(--primitive))` to the `:root` block of `semantic.css`.
3. A component need: add `--<component>-<part>-<property>: var(--semantic)` to the `:root` block of `components.css` and use it in the rule below.

Data-driven colours never go through JS colour math: JS emits a token reference and an amount (`--c: var(--cat-3); --t: .7`) and CSS mixes them
(`color-mix(in oklab, var(--c) calc(var(--t) * 100%), var(--map-blend-base))`). Party colours are a data table from party to token (`src/colors.js`).
Where JS truly needs a value (canvas) it calls `token(name, property)` from `src/design/tokens.js`, which resolves it through the browser.

## Enforcement

`npm run lint:tokens` (also in the Pages workflow) fails on colour literals, font-family literals and raw px/rem/em sizes in font-size, spacing, radius,
border, shadow, z-index and size properties anywhere in `src/` except `primitives.css`, and checks WCAG contrast of the semantic text, surface,
border, accent, status and candidate pairs in light and dark (4.5:1 text, 3:1 UI and graphics). Categorical hues below 3:1 are reported as warnings:
they are always backed by labels, tooltips and tables. `/design` renders every token group and component in the active theme.

## Standalone brand files

`public/favicon.svg`, `logo-mark.svg`, `logo.svg`, `logo-mono.svg`, the PNG icons, `favicon.ico`, `og-image.png` and the colours of
`site.webmanifest` cannot read page CSS variables, so they keep fixed values, but those values are *derived*: `npm run brand`
(`scripts/brand.mjs`) fills the templates in `scripts/brand/` with the brand primitives (`--brand-*`, slate scale) resolved by
`scripts/tokens.mjs` and renders the rasters with `rsvg-convert`/`convert`; never edit the generated files by hand. The header uses the
inline `Logo` component, which follows the tokens and the theme switch. The `theme-color` metas of `index.html` are generated at build time
from `--surface-page` (light and dark) by a small Vite plugin.

## Rules enforced by `lint:tokens`

No colour literal (hex, rgb(), hsl(), oklch(), named colours), no font-family literal, no raw px/rem/em in size, spacing, radius, border, shadow
and z-index properties, no `!important`, in `src/`, `index.html` and `vite.config.js` (except `primitives.css`); `@media (prefers-color-scheme` and
`[data-theme` only in `semantic.css`, so the semantic block is the only thing that changes per theme.
