# Auditoria eleitoral: brand

A magnifying glass over a small bar chart: audit (look closely) of election results (data). Deliberately neutral:
blue and amber, no party or candidate colours.

## Files

| File | Use |
|---|---|
| `logo.svg` | Horizontal lockup (mark + "Auditoria eleitoral"), wordmark outlined (no font needed). Adapts to `prefers-color-scheme` when opened or used as `<img>` |
| `logo-mark.svg` | The symbol alone (rounded square), for headers, avatars, small spaces |
| `logo-mono.svg` | One colour lockup in `currentColor`, no background: print, stamps, inline use that must follow a design token |
| `favicon.svg`, `favicon.ico` | Browser tab (SVG first, ICO 16/32/48 fallback) |
| `apple-touch-icon.png` | 180 px, full bleed (iOS applies its own corners) |
| `icon-192.png`, `icon-512.png` | Web app manifest icons, purpose `any` |
| `icon-maskable-512.png`, `icon-maskable.svg`, `icon-square.svg` | Maskable manifest icon (glyph inside the 80% safe zone) and the square sources |
| `og-image.png` | 1200 x 630 social preview (Open Graph / Twitter) |

## Colours

| Role | Value |
|---|---|
| Brand blue (symbol background) | `#1d4ed8` |
| Brand amber (bars) | `#fbbf24` |
| Wordmark on light | `#0f172a` |
| Wordmark on dark | `#e2e8f0` |
| Lens and handle | `#ffffff` |

## Rules

- Keep clear space around the lockup of at least the height of the bars (about one fifth of the symbol).
- Minimum sizes: symbol 16 px, lockup 120 px wide (below that use the symbol alone).
- Do not recolour, stretch, rotate, add shadows or put it on a busy background; on photos use `logo-mono.svg` over a flat plate.
- Never use party or candidate colours (PT red, PL violet) with it.

## HTML

```html
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta property="og:image" content="https://brauliobo.github.io/brazil-audit/og-image.png">
<meta name="twitter:card" content="summary_large_image">
```

Wordmark font: Noto Sans (SIL OFL), SemiBold for "Auditoria", Regular for "eleitoral"; converted to outlines.
