<script setup vapor>
import { useTemplateRef, watchEffect } from 'vue'
import { theme, token } from '../design/tokens'
import { int, num } from '../format'
import { t } from '../i18n'

// Canvas scatter for thousands of points: points = [[x, y], …]. Colours and fonts are read from the design tokens (canvas cannot
// use CSS variables) and the chart redraws when the theme changes. `marks` are points drawn on top in the highlight colour and `curves`
// lines ([[x, y], …] each, e.g. control limits) clipped to the extent of points + marks.
const props = defineProps({ points: Array, marks: { type: Array, default: () => [] }, curves: { type: Array, default: () => [] }, xLabel: String, yLabel: String })
const canvas = useTemplateRef('cv')
const M = { l: 48, r: 10, t: 10, b: 30 }
const DOT = 3
const ALPHA = 0.35

watchEffect(() => {
  theme.value
  const el = canvas.value
  if (!el) return
  const ctx = el.getContext('2d')
  const { width: w, height: h } = el
  const all = [...props.points, ...props.marks]
  const xs = all.map((p) => p[0])
  const ys = all.map((p) => p[1])
  const extent = (vs) => vs.reduce(([lo, hi], v) => [Math.min(lo, v), Math.max(hi, v)], [Infinity, -Infinity]) // not Math.min(...vs): states have 100k sections
  const [[x0, x1], [y0, y1]] = [extent(xs), extent(ys)]
  const px = (x) => M.l + ((x - x0) / (x1 - x0 || 1)) * (w - M.l - M.r)
  const py = (y) => h - M.b - ((y - y0) / (y1 - y0 || 1)) * (h - M.t - M.b)
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = token('--chart-bar')
  ctx.globalAlpha = ALPHA
  for (const [x, y] of props.points) ctx.fillRect(px(x) - DOT / 2, py(y) - DOT / 2, DOT, DOT)
  ctx.globalAlpha = 1
  ctx.save()
  ctx.beginPath()
  ctx.rect(M.l, M.t, w - M.l - M.r, h - M.t - M.b)
  ctx.clip()
  ctx.strokeStyle = token('--chart-axis-text')
  for (const curve of props.curves) {
    ctx.beginPath()
    curve.forEach(([x, y], i) => (i ? ctx.lineTo(px(x), py(y)) : ctx.moveTo(px(x), py(y))))
    ctx.stroke()
  }
  ctx.restore()
  ctx.fillStyle = token('--chart-highlight')
  for (const [x, y] of props.marks) ctx.fillRect(px(x) - DOT / 2, py(y) - DOT / 2, DOT + 1, DOT + 1)
  ctx.fillStyle = token('--chart-axis-text')
  ctx.font = `${token('--viz-font-sm', 'fontSize')} ${token('--font-sans', 'fontFamily')}`
  ctx.fillText(int(x0), M.l, h - M.b / 2)
  ctx.textAlign = 'right'
  ctx.fillText(`${int(x1)}  ${props.xLabel}`, w - M.r, h - M.b / 2)
  ctx.fillText(num(y0), M.l - 6, h - M.b)
  ctx.fillText(num(y1), M.l - 6, M.t + 8)
  ctx.save()
  ctx.translate(12, h / 2)
  ctx.rotate(-Math.PI / 2)
  ctx.textAlign = 'center'
  ctx.fillText(props.yLabel, 0, 0)
  ctx.restore()
})
</script>

<template lang="pug">
canvas.scatter(ref="cv" width="640" height="320" role="img" :aria-label="t('common.scatterLabel', { x: xLabel, y: yLabel })")
</template>
