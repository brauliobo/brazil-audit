<script setup vapor>
import { computed, ref } from 'vue'

// Parliament chart: one equal-area dot per seat, laid out in concentric half-circle rows and filled group by group from
// left to right. groups = [{ key, label, seats, color }]; hovering a dot or a legend entry highlights that group.
const props = defineProps({ groups: Array, label: String })
const active = ref(null)
const W = 600
const R = 290
const INNER = 0.38

// k rows; the seats of each row are proportional to its radius, so the dot spacing is the same along and across rows
function layout(n, k) {
  const rows = Array.from({ length: k }, (_, i) => R * (INNER + ((1 - INNER) * (i + 0.5)) / k))
  const total = rows.reduce((t, r) => t + r, 0)
  const counts = rows.map((r) => Math.round((n * r) / total))
  counts[k - 1] += n - counts.reduce((t, c) => t + c, 0)
  const pitch = Math.min((R * (1 - INNER)) / k, ...rows.map((r, i) => (Math.PI * r) / counts[i]))
  return { rows, counts, pitch }
}

const geometry = computed(() => {
  const n = props.groups.reduce((t, g) => t + g.seats, 0)
  const best = Array.from({ length: 14 }, (_, i) => layout(n, i + 2)).reduce((a, b) => (b.pitch > a.pitch ? b : a))
  const dots = best.rows.flatMap((r, i) => Array.from({ length: best.counts[i] }, (_, j) => {
    const angle = Math.PI * (1 - (j + 0.5) / best.counts[i])
    return { angle, x: W / 2 + r * Math.cos(angle), y: R + 10 - r * Math.sin(angle) }
  }))
  dots.sort((a, b) => b.angle - a.angle)
  const owners = props.groups.flatMap((g, gi) => Array(g.seats).fill(gi))
  return { radius: (best.pitch / 2) * 0.86, dots: dots.map((d, i) => ({ ...d, g: owners[i] })) }
})

const markup = computed(() => {
  const { radius, dots } = geometry.value
  return dots.map((d) => `<circle data-g="${d.g}" cx="${d.x.toFixed(1)}" cy="${d.y.toFixed(1)}" r="${radius.toFixed(1)}" fill="${props.groups[d.g].color}"${active.value != null && active.value !== d.g ? ' opacity=".2"' : ''}/>`).join('')
})
const total = computed(() => props.groups.reduce((t, g) => t + g.seats, 0))
const hover = (e) => (active.value = e.target.dataset?.g == null ? null : +e.target.dataset.g)
const group = computed(() => props.groups[active.value])
</script>

<template lang="pug">
.hemicycle
  svg.hemi(:viewBox="`0 0 ${W} ${R + 24}`" role="img" :aria-label="label" @mousemove="hover" @mouseleave="active = null")
    g(v-html="markup")
    text.total(:x="W / 2" :y="R - 14" text-anchor="middle") {{ group ? group.seats : total }}
    text.sub(:x="W / 2" :y="R + 8" text-anchor="middle") {{ group ? group.label : 'cadeiras' }}
  ul.seats
    li(v-for="(g, i) in groups" :key="g.key" tabindex="0" :class="{ off: active != null && active !== i }" @mouseenter="active = i" @mouseleave="active = null" @focus="active = i" @blur="active = null")
      i.sw(:style="{ background: g.color }")
      span.name {{ g.label }}
      b {{ g.seats }}
</template>
