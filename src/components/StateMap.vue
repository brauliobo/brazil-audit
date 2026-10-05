<script setup vapor>
import { href, go } from '../router'
import { loadGeo } from '../geo'
import { ensureRollups, unitSql, unitsOf } from '../results'
import { useAsync } from '../use'
import WinnerMap from './WinnerMap.vue'

// Municipality map of one state coloured by the winner of `office` (the mini-map next to the drill-down table).
const props = defineProps({ year: String, uf: String, office: Number })
const view = useAsync(() => [props.year, props.uf, props.office], async ([y, uf, o], q) => {
  await ensureRollups(y)
  const [rows, map] = await Promise.all([q(unitSql(y, 'mun'), [o, uf, '']), loadGeo(uf)])
  return { units: unitsOf(rows), map }
})
const open = (id) => go(href(props.year, 'drill', [props.uf, view.data.units.get(id).name], { office: props.office }))
</script>

<template lang="pug">
.statemap(v-if="view.data")
  WinnerMap(:units="view.data.units" :map="view.data.map" grain="mun" :office="office" :label="`Mapa dos municípios de ${uf.toUpperCase()}`" @pick="open")
  p.muted Fonte: TSE, IBGE.
</template>
