// Regression check for the inline logo: the lockup must render BOTH wordmark outlines ("Auditoria" and "eleitoral" are two separate
// paths: the second starts with a relative moveto, so concatenating them into one path moves it and it disappears) and, at the header height
// (--logo-size = 2rem), the lockup is about 169 px wide. Static part of the check; the rendered width is asserted in the browser by
// a browser probe (agent-browser) with `getBoundingClientRect()` on `.brand__full`.
import { readFileSync } from 'node:fs'

const src = readFileSync('src/components/Logo.vue', 'utf8')
const words = [...src.matchAll(/'([Mm] [^']+)'/g)].map((m) => m[1])
const [width, height] = [+(src.match(/: '0 0 (\d+) (\d+)'/)?.[1] ?? 0), +(src.match(/: '0 0 (\d+) (\d+)'/)?.[2] ?? 1)]
const px = (width / height) * 32 // 2rem = 32px at the 16px root
const problems = []
if (words.length !== 2) problems.push(`expected 2 wordmark paths, found ${words.length}`)
if (Math.abs(px - 169) > 2) problems.push(`lockup width at 2rem height would be ${px.toFixed(1)} px, expected about 169`)
console.log(`logo: ${words.length} wordmark paths, lockup ${px.toFixed(1)} px wide at 2rem height${problems.length ? '' : ' (ok)'}`)
for (const p of problems) console.log(`  ${p}`)
process.exit(problems.length ? 1 : 0)
