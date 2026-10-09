<script setup vapor>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { LINE, boundsOf, compose, layout, textBox } from '../shapes'
import Tooltip from './Tooltip.vue'

// Choropleth over pre-projected SVG paths. The paths are one innerHTML string and events are delegated to the svg (5.5k
// municipalities: no per-path listeners). fills: { id: [color, t] } where color is a CSS value (var(--...)) and t in 0..1 is the
// share of that colour mixed into the map base (done in CSS, see .map path[style]); tip(id) returns the tooltip text.
// view: the ids to show, the map being cropped to them (a region). marks: { id: [variant, ...] } written inside the shapes (see layout() in
// shapes.js), at a font size that renders as MARK_PX when the map is `width` px wide; with callouts the shapes that cannot hold the text get it beside the map.
// groups: { id: [shape ids] } puts the marks on groups of shapes (a region) instead of on each shape; marks is then keyed by the group id.
const props = defineProps({ groups: Object, map: Object, overlay: Object, fills: Object, tip: Function, label: String, keyboard: Boolean, view: Array, marks: Object, callouts: Boolean, width: { type: Number, default: 640 } })
const emit = defineEmits(['pick', 'hover'])
const MARK_PX = 12
const GUTTER = 64 // page and panel padding around the map, to size the text for narrow screens
const tooltip = ref({ text: '', x: 0, y: 0, show: false })
const outlined = ref(null) // the shape under the pointer or focus: its outline is drawn on top of all shapes, or the neighbours drawn later would cover part of it
const hot = ref(null) // the group under the pointer (its shapes are highlighted together, with no outline of their own)
const viewport = ref(innerWidth)
const resize = () => (viewport.value = innerWidth)
onMounted(() => addEventListener('resize', resize))
onUnmounted(() => removeEventListener('resize', resize))

watch(() => props.map, () => (tooltip.value.show = false)) // a tooltip from the previous map must not linger

const pathOf = computed(() => new Map(props.map.items.map(([id, d]) => [String(id), d]))) // dataset ids are strings, the municipality ids numbers
const items = computed(() => (props.view ? props.map.items.filter(([id]) => props.view.includes(id)) : props.map.items))
const bounds = computed(() => (props.view ? boundsOf(items.value.map(([, d]) => d)) : [0, 0, props.map.w, props.map.h]))
const size = computed(() => ((bounds.value[2] - bounds.value[0]) * MARK_PX) / Math.min(props.width, viewport.value - GUTTER))
const markItems = computed(() => (props.groups ? Object.entries(props.groups).map(([g, ids]) => [g, compose(ids.map((id) => pathOf.value.get(id)))]) : items.value))
const placed = computed(() => (props.marks ? layout(markItems.value, props.marks, { size: size.value, callouts: props.callouts }) : { labels: [], right: 0, bottom: 0 }))
const box = computed(() => {
  const [x0, y0, x1, y1] = bounds.value
  const pad = props.view ? size.value : 0 // the whole map has its own margins
  return [x0 - pad, y0 - pad, Math.max(x1, placed.value.right) + pad - (x0 - pad), Math.max(y1, placed.value.bottom) + pad - (y0 - pad)]
})
const lineY = (l, i) => l.y0 + (i + 0.5) * LINE * size.value
const leader = (l) => ({ x1: l.from[0], y1: l.from[1], x2: l.x - 0.25 * size.value, y2: l.y0 + textBox(l.lines, size.value)[1] / 2 })

const groupOf = computed(() => Object.fromEntries(Object.entries(props.groups ?? {}).flatMap(([g, ids]) => ids.map((id) => [id, g]))))
const attr = (id) => (props.fills[id] ? ` style="--c:${props.fills[id][0]};--t:${props.fills[id][1].toFixed(2)}"` : '')
const focusable = (id) => (props.keyboard && props.fills[id] ? ` tabindex="0" role="button" aria-label="${props.tip(id).split('\n')[0].replaceAll('"', '&quot;')}"` : '')
const paths = computed(() => items.value.map(([id, d]) => `<path data-id="${id}" d="${d}"${groupOf.value[id] && groupOf.value[id] === hot.value ? ' class="hot"' : ''}${attr(id)}${focusable(id)}/>`).join(''))
const borders = computed(() => (props.overlay ? props.overlay.items.map(([, d]) => `<path d="${d}"/>`).join('') : ''))

const idOf = (e) => (props.fills[e.target.dataset?.id] ? e.target.dataset.id : null) // polygons without data are inert
function show(e) {
  const id = idOf(e)
  hot.value = groupOf.value[id] ?? null
  outlined.value = props.groups ? null : id
  if (!id) { tooltip.value.show = false; return }
  emit('hover', id)
  const box = e.currentTarget.parentElement.getBoundingClientRect()
  const at = e.type === 'focusin' ? e.target.getBoundingClientRect() : { left: e.clientX, top: e.clientY }
  Object.assign(tooltip.value, { text: props.tip(id), x: at.left - box.left + 12, y: at.top - box.top + 12, show: true })
}
const leave = () => { tooltip.value.show = false; hot.value = outlined.value = null }
const pick = (e) => idOf(e) && emit('pick', idOf(e))
const key = (e) => (e.key === 'Enter' || e.key === ' ') && pick(e)
</script>

<template lang="pug">
.geomap
  svg.map(:viewBox="box.join(' ')" role="group" :aria-label="label" @mousemove="show" @mouseleave="leave" @click="pick" @keydown="key" @focusin="show" @focusout="leave")
    g.map__units(v-html="paths")
    g.map__borders(v-html="borders")
    path.map__outline(v-if="outlined" :d="pathOf.get(outlined)")
    g.map__marks(v-if="placed.labels.length" :font-size="size" :stroke-width="size * 0.2")
      template(v-for="l in placed.labels" :key="l.id")
        line.map__leader(v-if="l.from" v-bind="leader(l)")
        text.map__mark(v-for="(line, i) in l.lines" :key="i" :class="{ 'map__mark--head': l.head && i === 0, 'map__mark--out': l.out }" :x="l.x" :y="lineY(l, i)" :text-anchor="l.out ? 'start' : 'middle'" dominant-baseline="central") {{ line }}
    text.map__label(v-for="l in (view ? [] : map.labels)" :key="l.text" :x="l.x" :y="l.y" text-anchor="end") {{ l.text }}
  Tooltip(:text="tooltip.text" :x="tooltip.x" :y="tooltip.y" :show="tooltip.show")
</template>
