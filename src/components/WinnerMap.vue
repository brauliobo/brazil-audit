<script setup vapor>
import { computed } from 'vue'
import { partyColor } from '../colors'
import { preloadState } from '../geo'
import { pct } from '../format'
import { titleCase, unitTip, winnerFills, winnerLegend } from '../results'
import GeoMap from './GeoMap.vue'

// Winner map of a set of units (states or municipalities): party colour, intensity by margin, legend, tooltip.
// units = Map of unitsOf(); abroad = optional state row for the "Exterior" chip (no polygon).
const props = defineProps({ units: Map, map: Object, grain: String, office: { type: Number, default: 1 }, abroad: Object, label: String })
const emit = defineEmits(['pick'])
const isUf = computed(() => props.grain === 'uf')
const fills = computed(() => winnerFills(props.units))
const legend = computed(() => winnerLegend(props.units, props.office, 5))
const tip = (id) => unitTip(props.units.get(id), props.grain, isUf.value ? ['Clique para ver os municípios'] : [])
</script>

<template lang="pug">
.winnermap
  GeoMap(:map="map" :fills="fills" :tip="tip" :keyboard="isUf" :label="label" @pick="emit('pick', $event)" @hover="isUf && preloadState($event)")
  .legend-row
    span.key(v-for="l in legend" :key="l.party")
      i.sw(:style="{ background: partyColor(l.party) }")
      | {{ l.label }} · {{ l.n }}
    span.key(v-if="abroad")
      i.sw(:style="{ background: partyColor(abroad.party) }")
      | Exterior: {{ titleCase(abroad.name ?? abroad.cand) }} {{ pct(abroad.votes / abroad.valid, 1) }}
</template>
