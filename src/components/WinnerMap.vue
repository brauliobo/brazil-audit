<script setup vapor>
import { computed } from 'vue'
import { partyColor } from '../colors'
import { preloadState } from '../geo'
import { pct } from '../format'
import { titleCase, unitTip, winnerFills, winnerLegend } from '../results'
import GeoMap from './GeoMap.vue'
import Legend from './Legend.vue'

// Winner map of a set of units (states or municipalities): party colour, intensity by margin, legend, tooltip.
// units = Map of unitsOf(); abroad = optional state row for the "Exterior" chip (no polygon).
const props = defineProps({ units: Map, map: Object, grain: String, office: { type: Number, default: 1 }, abroad: Object, label: String })
const emit = defineEmits(['pick'])
const isUf = computed(() => props.grain === 'uf')
const fills = computed(() => winnerFills(props.units))
const legend = computed(() => [
  ...winnerLegend(props.units, props.office, 5).map((l) => ({ color: partyColor(l.party), label: `${l.label} · ${l.n}` })),
  ...(props.abroad ? [{ color: partyColor(props.abroad.party), label: `Exterior: ${titleCase(props.abroad.name ?? props.abroad.cand)} ${pct(props.abroad.votes / props.abroad.valid, 1)}` }] : []),
])
const tip = (id) => unitTip(props.units.get(id), props.grain, isUf.value ? ['Clique para ver os municípios'] : [])
</script>

<template lang="pug">
.winnermap
  GeoMap(:map="map" :fills="fills" :tip="tip" :keyboard="isUf" :label="label" @pick="emit('pick', $event)" @hover="isUf && preloadState($event)")
  Legend(:items="legend")
</template>
