<script setup vapor>
import { useTemplateRef, watchEffect } from 'vue'
import { theme, token } from '../design/tokens'

// Canvas scatter for thousands of points: points = [[x, y], …]. Colours and fonts are read from the design tokens (canvas cannot
// use CSS variables) and the chart redraws when the theme changes.
const props = defineProps({ points: Array, xLabel: String, yLabel: String })
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
  const xs = props.points.map((p) => p[0])
  const ys = props.points.map((p) => p[1])
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const px = (x) => M.l + ((x - x0) / (x1 - x0 || 1)) * (w - M.l - M.r)
  const py = (y) => h - M.b - ((y - y0) / (y1 - y0 || 1)) * (h - M.t - M.b)
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = token('--chart-bar')
  ctx.globalAlpha = ALPHA
  for (const [x, y] of props.points) ctx.fillRect(px(x) - DOT / 2, py(y) - DOT / 2, DOT, DOT)
  ctx.globalAlpha = 1
  ctx.fillStyle = token('--chart-axis-text')
  ctx.font = `${token('--viz-font-sm', 'fontSize')} ${token('--font-sans', 'fontFamily')}`
  ctx.fillText(`${x0.toLocaleString('pt-BR')}`, M.l, h - M.b / 2)
  ctx.textAlign = 'right'
  ctx.fillText(`${x1.toLocaleString('pt-BR')}  ${props.xLabel}`, w - M.r, h - M.b / 2)
  ctx.fillText(y0.toFixed(2), M.l - 6, h - M.b)
  ctx.fillText(y1.toFixed(2), M.l - 6, M.t + 8)
  ctx.save()
  ctx.translate(12, h / 2)
  ctx.rotate(-Math.PI / 2)
  ctx.textAlign = 'center'
  ctx.fillText(props.yLabel, 0, 0)
  ctx.restore()
})
</script>

<template lang="pug">
canvas.scatter(ref="cv" width="640" height="320" role="img" :aria-label="`Dispersão: ${xLabel} contra ${yLabel}`")
</template>
