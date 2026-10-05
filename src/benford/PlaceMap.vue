<script setup vapor>
import { computed } from 'vue'
import GeoMap from '../components/GeoMap.vue'
import { quantile } from '../results'
import { int, num, pct } from '../format'
import { stateTitle } from '../labels'
import Legend from '../components/Legend.vue'
import { t } from '../i18n'

// Map of the deviation of each UF or municipality (section unit): the adjusted index (MAD against the simulated baseline) or the
// plain MAD. Places below the minimum N or without data stay grey; the tooltip carries N and the numbers.
const props = defineProps({ places: Array, map: Object, overlay: Object, metric: String, keyboard: Boolean })
const emit = defineEmits(['pick'])
const byId = computed(() => new Map(props.places.filter((p) => p.id).map((p) => [p.id, p])))
const value = (r) => r[props.metric]
const readable = (p) => !p.result.small && value(p.result) != null
const scale = computed(() => (props.metric === 'index' ? 3 : quantile(props.places.filter(readable).map((p) => Math.abs(value(p.result))), 0.95) || 1))
const strength = (v) => 0.2 + 0.8 * Math.min(Math.abs(v) / scale.value, 1)
const fills = computed(() => Object.fromEntries(props.places.filter((p) => p.id && readable(p)).map((p) => {
  const v = value(p.result)
  return [p.id, [props.metric === 'mad' ? 'var(--chart-bar)' : v >= 0 ? 'var(--chart-highlight)' : 'var(--accent)', strength(v)]]
})))
const name = (p) => (p.city ? `${p.city} (${p.uf.toUpperCase()})` : stateTitle(p.uf))
const tip = (id) => {
  const p = byId.value.get(id)
  if (!p) return t('benford.map.none')
  const [r, place] = [p.result, name(p)]
  if (r.small) return t('benford.map.tipSmall', { place, n: int(r.n), min: int(r.minN) })
  const b = r.baseline?.mad
  return b ? t('benford.map.tip', { place, n: int(r.n), mad: num(r.mad, 4), base: num(b.mean, 4), lo: num(b.lo, 4), hi: num(b.hi, 4), excess: r.excess == null ? t('benford.stats.none') : pct(r.excess, 1), index: r.index == null ? t('benford.stats.none') : num(r.index, 1) }) : t('benford.map.tipNoBase', { place, n: int(r.n), mad: num(r.mad, 4) })
}
const hidden = computed(() => props.places.filter((p) => !readable(p)).length)
</script>

<template lang="pug">
.bf-map
  GeoMap(:map="map" :overlay="overlay" :fills="fills" :tip="tip" :keyboard="keyboard" :label="t('benford.map.label')" @pick="emit('pick', $event)")
  Legend
    template(v-if="metric === 'mad'")
      span.muted {{ t('benford.map.legendMad') }} 0
      i.legend__ramp.bf-ramp--mad
      span.muted {{ num(scale, 3) }}
    template(v-else)
      span.muted {{ t('benford.map.legendDiverging', { scale: metric === 'excess' ? pct(scale, 0) : num(scale, 0) }) }}
      i.legend__ramp.bf-ramp--diverging
    span.muted {{ t('benford.map.hidden', { count: hidden }) }}
</template>
