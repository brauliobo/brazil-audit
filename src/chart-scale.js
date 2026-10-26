// log1p keeps zero at the baseline and makes small positive counts visible.
export function chartScale(top, logarithmic = false) {
  const position = logarithmic ? (value) => Math.log1p(value) / Math.log1p(top) : (value) => value / top
  const ticks = logarithmic ? [0, ...Array.from({ length: Math.max(0, Math.ceil(Math.log10(top)) - 1) }, (_, i) => 10 ** (i + 1)).filter((v) => v < top), top] : [0, 1, 2, 3, 4].map((i) => top * i / 4)
  return { position, ticks }
}
