<script setup vapor>
import { computed, ref, watch } from 'vue'
import Tooltip from './Tooltip.vue'

// Choropleth over pre-projected SVG paths. The paths are one innerHTML string and events are delegated to the svg (5.5k
// municipalities: no per-path listeners). fills: { id: [color, t] } where color is a CSS value (var(--...)) and t in 0..1 is the
// share of that colour mixed into the map base (done in CSS, see .map path[style]); tip(id) returns the tooltip text.
const props = defineProps({ map: Object, overlay: Object, fills: Object, tip: Function, label: String, keyboard: Boolean })
const emit = defineEmits(['pick', 'hover'])
const tooltip = ref({ text: '', x: 0, y: 0, show: false })

watch(() => props.map, () => (tooltip.value.show = false)) // a tooltip from the previous map must not linger

const attr = (id) => (props.fills[id] ? ` style="--c:${props.fills[id][0]};--t:${props.fills[id][1].toFixed(2)}"` : '')
const focusable = (id) => (props.keyboard ? ` tabindex="0" role="button" aria-label="${props.tip(id).split('\n')[0].replaceAll('"', '&quot;')}"` : '')
const paths = computed(() => props.map.items.map(([id, d]) => `<path data-id="${id}" d="${d}"${attr(id)}${focusable(id)}/>`).join(''))
const borders = computed(() => (props.overlay ? props.overlay.items.map(([, d]) => `<path d="${d}"/>`).join('') : ''))

const idOf = (e) => e.target.dataset?.id
function show(e) {
  const id = idOf(e)
  if (!id) { tooltip.value.show = false; return }
  emit('hover', id)
  const box = e.currentTarget.parentElement.getBoundingClientRect()
  const at = e.type === 'focusin' ? e.target.getBoundingClientRect() : { left: e.clientX, top: e.clientY }
  Object.assign(tooltip.value, { text: props.tip(id), x: at.left - box.left + 12, y: at.top - box.top + 12, show: true })
}
const pick = (e) => idOf(e) && emit('pick', idOf(e))
const key = (e) => (e.key === 'Enter' || e.key === ' ') && pick(e)
</script>

<template lang="pug">
.geomap
  svg.map(:viewBox="`0 0 ${map.w} ${map.h}`" role="group" :aria-label="label" @mousemove="show" @mouseleave="tooltip.show = false" @click="pick" @keydown="key" @focusin="show")
    g.map__units(v-html="paths")
    g.map__borders(v-html="borders")
    text.map__label(v-for="l in map.labels" :key="l.text" :x="l.x" :y="l.y" text-anchor="end") {{ l.text }}
  Tooltip(:text="tooltip.text" :x="tooltip.x" :y="tooltip.y" :show="tooltip.show")
</template>
