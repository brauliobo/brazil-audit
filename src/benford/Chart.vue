<script setup vapor>
import { computed, onMounted, onUnmounted, ref, useTemplateRef } from 'vue'
import { pct } from '../format'
import Legend from '../components/Legend.vue'
import { t } from '../i18n'

// Grouped bars: observed proportion per digit, the Benford curve with its 95% band, and the simulated baseline (I-beam with
// the envelope and a tick on the mean). The svg is drawn at its real width so the text keeps its size on narrow screens.
const props = defineProps({ result: Object, title: String, compact: Boolean })
const box = useTemplateRef('box')
const width = ref(640)
const hover = ref(null)
let observer
onMounted(() => {
  // the svg height follows its width, which resizes the observed box again: applying the width a frame later avoids the loop warning
  observer = new ResizeObserver(([e]) => requestAnimationFrame(() => (width.value = Math.max(240, Math.round(e.contentRect.width)))))
  observer.observe(box.value)
})
onUnmounted(() => observer?.disconnect())

const M = computed(() => ({ l: props.compact ? 30 : 46, r: 6, t: props.compact ? 8 : 14, b: props.compact ? 16 : 24 }))
const height = computed(() => (props.compact ? 130 : width.value < 480 ? 250 : 300))
const plot = computed(() => ({ w: width.value - M.value.l - M.value.r, h: height.value - M.value.t - M.value.b }))
const r = computed(() => props.result)
const TICKS = computed(() => (props.compact ? 2 : 4))
const step = computed(() => {
  const base = r.value.baseline?.digits?.map((d) => d.hi) ?? []
  const raw = (Math.max(...r.value.props, ...r.value.probs, ...base, ...r.value.z.map((z) => z.hi)) * 1.05) / TICKS.value
  const mag = 10 ** Math.floor(Math.log10(raw))
  return ([1, 2, 2.5, 5, 10].find((f) => f * mag >= raw) ?? 10) * mag
})
const top = computed(() => step.value * TICKS.value)
const y = (v) => M.value.t + plot.value.h * (1 - v / top.value)
const slot = computed(() => plot.value.w / r.value.digits.length)
const cx = (i) => M.value.l + (i + 0.5) * slot.value
const dec = computed(() => [0, 1, 2].find((d) => Math.abs(step.value * 100 * 10 ** d - Math.round(step.value * 100 * 10 ** d)) < 1e-9) ?? 2)

const cells = computed(() => r.value.digits.map((d, i) => {
  const b = r.value.baseline?.digits?.[i]
  const w = Math.min(Math.max(slot.value * 0.7, 1.5), 28)
  return {
    d, i, x: cx(i) - w / 2, w, top: y(r.value.props[i]), h: plot.value.h * (r.value.props[i] / top.value),
    env: b && { x: cx(i), lo: y(b.lo), hi: y(b.hi), mean: y(b.mean), cap: Math.min(slot.value * 0.34, 9) },
    flag: r.value.outside[i], tip: tip(i),
  }
}))
const tip = (i) => {
  const b = r.value.baseline?.digits?.[i]
  const [d, obs, law] = [r.value.digits[i], pct(r.value.props[i], 2), pct(r.value.probs[i], 2)]
  return b ? t('benford.chart.barTip', { d, obs, law, base: pct(b.mean, 2), lo: pct(b.lo, 2), hi: pct(b.hi, 2) }) : t('benford.chart.barTipNoBase', { d, obs, law })
}
const law = computed(() => r.value.probs.map((p, i) => `${cx(i)},${y(p)}`).join(' '))
const band = computed(() => {
  const z = r.value.z
  return [...z.map((b, i) => `${cx(i)},${y(b.hi)}`), ...z.map((b, i) => `${cx(i)},${y(b.lo)}`).reverse()].join(' ')
})
const ticks = computed(() => Array.from({ length: TICKS.value + 1 }, (_, i) => ({ y: y(step.value * i), t: pct(step.value * i, dec.value) })))
const labels = computed(() => {
  const every = r.value.digits.length > 20 ? 10 : 1
  return cells.value.filter((c) => c.d % every === 0 || every === 1)
})
const legend = computed(() => [{ color: 'var(--chart-bar)', label: t('benford.chart.observed') }, { color: 'var(--benford-band)', label: t('benford.chart.band') }])
const focusable = computed(() => !props.compact && r.value.digits.length <= 10)
</script>

<template lang="pug">
.bf-chart(ref="box")
  svg.chart.bf(:viewBox="`0 0 ${width} ${height}`" role="img" :aria-label="`${title}. ${t('benford.chart.alt')}`")
    title {{ title }}
    g.chart__grid(v-for="tick in ticks" :key="tick.y")
      line(:x1="M.l" :x2="width - M.r" :y1="tick.y" :y2="tick.y")
      text(:x="M.l - 5" :y="tick.y + 4" text-anchor="end") {{ tick.t }}
    polygon.bf-band(:points="band")
    g.bf-digit(v-for="c in cells" :key="c.d" :tabindex="focusable ? 0 : undefined" @mouseenter="hover = c.i" @focus="hover = c.i" @mouseleave="hover = null" @blur="hover = null")
      title {{ c.tip }}
      rect.chart__bar(:x="c.x" :y="c.top" :width="c.w" :height="c.h")
      g.bf-env(v-if="c.env")
        line(:x1="c.env.x" :x2="c.env.x" :y1="c.env.hi" :y2="c.env.lo")
        line(:x1="c.env.x - c.env.cap" :x2="c.env.x + c.env.cap" :y1="c.env.hi" :y2="c.env.hi")
        line(:x1="c.env.x - c.env.cap" :x2="c.env.x + c.env.cap" :y1="c.env.lo" :y2="c.env.lo")
        line.bf-env__mean(:x1="c.env.x - c.env.cap" :x2="c.env.x + c.env.cap" :y1="c.env.mean" :y2="c.env.mean")
      text.bf-flag(v-if="c.flag && !compact" :x="cx(c.i)" :y="Math.min(c.top, c.env ? c.env.hi : c.top) - 4" text-anchor="middle") {{ c.flag > 0 ? '▲' : '▼' }}
    polyline.chart__overlay(:points="law")
    circle.bf-dot(v-for="(p, i) in result.probs" :key="i" :cx="cx(i)" :cy="y(p)" r="2.5")
    text(v-for="c in labels" :key="c.d" :x="cx(c.i)" :y="height - (compact ? 3 : 7)" text-anchor="middle") {{ c.d }}
  template(v-if="!compact")
    p.bf-hover(aria-live="polite") {{ hover != null ? cells[hover].tip : '' }}
    Legend(:items="legend")
      span.legend__item
        i.bf-key.bf-key--law
        | {{ t('benford.chart.law') }}
      span.legend__item(v-if="result.baseline?.digits")
        i.bf-key.bf-key--env
        | {{ t('benford.chart.envelope') }}
      span.legend__item(v-if="result.baseline?.digits")
        span.bf-key--glyph ▲ ▼
        | {{ t('benford.chart.above') }} / {{ t('benford.chart.below') }}
</template>
