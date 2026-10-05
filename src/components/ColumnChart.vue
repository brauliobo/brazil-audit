<script setup vapor>
import { computed } from 'vue'

// SVG column chart; `line` optionally overlays a second series (e.g. the Benford expectation).
const props = defineProps({ values: Array, labels: Array, line: Array, height: { type: Number, default: 220 }, fmt: { type: Function, default: (v) => String(Math.round(v)) }, tick: Function })
const W = 640
const L = 46
const B = 22
const plot = computed(() => ({ w: W - L - 8, h: props.height - B - 8 }))
const top = computed(() => {
  const m = Math.max(...props.values, ...(props.line ?? []), 1e-9)
  const mag = 10 ** Math.floor(Math.log10(m))
  return Math.ceil(m / mag * 2) / 2 * mag
})
const bars = computed(() => {
  const step = plot.value.w / props.values.length
  return props.values.map((v, i) => ({ x: L + i * step + step * 0.08, w: step * 0.84, y: 8 + plot.value.h * (1 - v / top.value), h: plot.value.h * v / top.value, t: `${props.labels[i]}: ${props.fmt(v)}` }))
})
const dots = computed(() => (props.line ?? []).map((v, i) => `${L + (i + 0.5) * plot.value.w / props.values.length},${8 + plot.value.h * (1 - v / top.value)}`).join(' '))
const ticks = computed(() => [0, 1, 2, 3, 4].map((i) => ({ y: 8 + plot.value.h * (1 - i / 4), t: (props.tick ?? props.fmt)(top.value * i / 4) })))
const xlabels = computed(() => {
  const every = Math.ceil(props.values.length / 12)
  return props.labels.map((t, i) => ({ t, x: L + (i + 0.5) * plot.value.w / props.values.length })).filter((_, i) => i % every === 0)
})
</script>

<template lang="pug">
svg.chart(:viewBox="`0 0 ${W} ${height}`" role="img")
  g.chart__grid(v-for="t in ticks" :key="t.y")
    line(:x1="L" :x2="W - 8" :y1="t.y" :y2="t.y")
    text(:x="L - 6" :y="t.y + 4" text-anchor="end") {{ t.t }}
  rect.chart__bar(v-for="(b, i) in bars" :key="i" :x="b.x" :y="b.y" :width="b.w" :height="b.h")
    title {{ b.t }}
  polyline.chart__overlay(v-if="line" :points="dots")
  text(v-for="l in xlabels" :key="l.x" :x="l.x" :y="height - 6" text-anchor="middle") {{ l.t }}
</template>
