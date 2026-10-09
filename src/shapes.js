// Geometry of the compact SVG paths in data/geo (an absolute M, then relative l/h/v, closed by z): enough to find where text fits inside
// a shape and to crop a map to some of its shapes. Pure, so it runs in the tests too.

const CHAR = 0.6 // average glyph width over the font size, bold digits included
export const LINE = 1.2 // line height over the font size
const GAP = 0.6 // font sizes between a shape and its callout, and between callouts
const TOUCH = 1e-6 // stretches that meet at a shared border are one
const ROWS = 24 // positions tried from the top of a shape to its bottom

/** The rings of a path as [[x, y]]. */
export function rings(d) {
  const out = []
  let [x, y] = [0, 0]
  for (const [, cmd, args] of d.matchAll(/([Mlhv])([^Mlhvz]*)/g)) {
    const n = (args.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number)
    if (cmd === 'M') { [x, y] = n; out.push([[x, y]]) }
    else if (cmd === 'l') for (let i = 0; i < n.length; i += 2) out.at(-1).push([(x += n[i]), (y += n[i + 1])])
    else if (cmd === 'h') for (const dx of n) out.at(-1).push([(x += dx), y])
    else for (const dy of n) out.at(-1).push([x, (y += dy)])
  }
  return out
}

const extent = (ring) => [Math.min(...ring.map((p) => p[0])), Math.min(...ring.map((p) => p[1])), Math.max(...ring.map((p) => p[0])), Math.max(...ring.map((p) => p[1]))]
const area = ([x0, y0, x1, y1]) => (x1 - x0) * (y1 - y0)

const cache = new Map()
/** { rs: all rings, box: [x0, y0, x1, y1] of the main ring }: islands and insets do not stretch the box. */
export function shapeOf(d) {
  if (!cache.has(d)) {
    const rs = rings(d)
    cache.set(d, { rs, box: rs.map(extent).reduce((a, b) => (area(b) > area(a) ? b : a)) })
  }
  return cache.get(d)
}

/** One path for several neighbouring shapes (a region), placed and cropped as a whole: its box is theirs, not that of its largest ring. */
export function compose(ds) {
  const d = ds.join('')
  cache.set(d, { rs: rings(d), box: boundsOf(ds) })
  return d
}

/** The box that holds all shapes: [x0, y0, x1, y1]. */
export const boundsOf = (ds) => ds.map((d) => shapeOf(d).box).reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])])

// the stretches of the horizontal line at y that are inside the shape (even-odd rule, so holes such as the DF in Goiás stay out)
function spans(rs, y) {
  const xs = rs.flatMap((r) => r.flatMap(([x1, y1], i) => {
    const [x2, y2] = r[(i + 1) % r.length]
    return (y1 <= y) !== (y2 <= y) ? [x1 + ((y - y1) / (y2 - y1)) * (x2 - x1)] : []
  })).sort((a, b) => a - b)
  return xs.flatMap((x, i) => (i % 2 ? [] : [[x, xs[i + 1]]])).reduce((out, [a, b]) => (out.length && a - out.at(-1)[1] < TOUCH ? [...out.slice(0, -1), [out.at(-1)[0], b]] : [...out, [a, b]]), [])
}

// the part of the stretch [a, b] that every row has in common, as the stretch of the row that overlaps it most
const common = (rows, [a, b]) => rows.reduce((cut, row) => cut && row.map(([c, d]) => [Math.max(cut[0], c), Math.min(cut[1], d)]).filter(([c, d]) => d > c).sort((p, q) => q[1] - q[0] - (p[1] - p[0]))[0], [a, b])

/** The centre of a w × h box that fits inside the shape, the closest one to the middle of the shape, or null. */
export function place(d, w, h) {
  const { rs, box: [x0, y0, x1, y1] } = shapeOf(d)
  if (w > x1 - x0 || h > y1 - y0) return null
  const middle = (y0 + y1) / 2
  let best = null
  for (let i = 0; i <= ROWS; i++) {
    const y = y0 + h / 2 + ((y1 - y0 - h) * i) / ROWS
    const rows = [y - h / 2, y - h / 4, y, y + h / 4, y + h / 2].map((at) => spans(rs, at))
    const fit = rows[2].map((s) => common(rows, s)).filter((c) => c && c[1] - c[0] >= w).sort((p, q) => q[1] - q[0] - (p[1] - p[0]))[0]
    if (fit && (!best || Math.abs(y - middle) < Math.abs(best.y - middle))) best = { x: (fit[0] + fit[1]) / 2, y }
  }
  return best
}

/** Width and height of the lines of text at a font size. */
export const textBox = (lines, size) => [(Math.max(...lines.map((l) => l.length)) * CHAR + 0.6) * size, lines.length * LINE * size]

const linesOf = (v) => [...(v.head ? [v.head] : []), ...v.rows]

/**
 * Where the marks of the shapes go. items: [[id, path]]; marks: { id: [variant, ...] }, a variant being { head?, rows: [text] }, the fullest first.
 * A mark is written inside its shape in the first variant that fits. With callouts, a shape where none fits gets its fullest variant in a column
 * at the right of the map, tied to the shape by a line (the column never overlaps itself). Returns { labels, right, bottom }: labels are
 * { id, x, y0 (top of the text), lines, head, out?, from? }, line i being centred at y0 + (i + 0.5) * LINE * size; right and bottom are how far the column reaches.
 */
export function layout(items, marks, { size, callouts }) {
  const labels = []
  const out = []
  for (const [id, d] of items) {
    const variants = marks?.[id]
    if (!variants) continue
    const fits = variants.map((v) => [v, ...textBox(linesOf(v), size)]).map(([v, w, h]) => [v, h, place(d, w, h)]).find(([, , at]) => at)
    if (fits) labels.push({ id, x: fits[2].x, y0: fits[2].y - fits[1] / 2, lines: linesOf(fits[0]), head: !!fits[0].head })
    else if (callouts) out.push({ id, d, v: variants[0] })
  }
  const edge = out.length ? Math.max(...items.map(([, d]) => shapeOf(d).box[2])) + GAP * size : 0
  let bottom = 0
  let right = 0
  for (const o of out.map((c) => ({ ...c, lines: linesOf(c.v) })).sort((a, b) => centre(a.d)[1] - centre(b.d)[1])) {
    const [w, h] = textBox(o.lines, size)
    const y0 = Math.max(centre(o.d)[1] - h / 2, bottom + GAP * size)
    labels.push({ id: o.id, x: edge, y0, lines: o.lines, head: !!o.v.head, out: true, from: centre(o.d) })
    bottom = y0 + h
    right = Math.max(right, edge + w)
  }
  return { labels, right, bottom }
}

const centre = (d) => { const [x0, y0, x1, y1] = shapeOf(d).box; return [(x0 + x1) / 2, (y0 + y1) / 2] }
