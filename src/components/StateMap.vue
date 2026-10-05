<script setup vapor>
import { computed } from 'vue'
import { href, go } from '../router'
import { partyColor } from '../colors'
import { loadGeo } from '../geo'
import { candName, ensureRollups, margin, quantile, titleCase, top, unitSql, unitsOf } from '../results'
import { useAsync } from '../use'
import { int, pct } from '../format'
import GeoMap from './GeoMap.vue'

// Municipality map of one state coloured by the winner of `office` (the mini-map next to the drill-down table).
const props = defineProps({ year: String, uf: String, office: Number })
const view = useAsync(() => [props.year, props.uf, props.office], async ([y, uf, o], q) => {
  await ensureRollups(y)
  const [rows, map] = await Promise.all([q(unitSql(y, 'mun'), [o, uf, '']), loadGeo(uf)])
  const units = unitsOf(rows)
  const hi = quantile([...units.values()].map(margin), 0.9)
  const fills = Object.fromEntries([...units].map(([id, u]) => [id, [partyColor(top(u, 1).party), 0.4 + 0.6 * Math.min(margin(u) / (hi || 1), 1)]]))
  return { units, map, fills }
})
const tip = (id) => {
  const u = view.data.units.get(id)
  return u ? [titleCase(u.name), ...u.list.filter((r) => r.rn <= 2).map((r) => `${candName(r)}: ${int(r.votes)} (${pct(r.votes / u.valid, 1)})`)].join('\n') : id
}
const open = (id) => go(href(props.year, 'drill', [props.uf, view.data.units.get(id).name], { office: props.office }))
const legend = computed(() => Object.entries(Object.groupBy([...view.data.units.values()], (u) => top(u, 1).party ?? '–')).map(([party, l]) => ({ party, n: l.length, name: candName(top(l[0], 1)) })).sort((a, b) => b.n - a.n).slice(0, 5))
</script>

<template lang="pug">
.statemap(v-if="view.data")
  GeoMap(:map="view.data.map" :fills="view.data.fills" :tip="tip" :label="`Mapa dos municípios de ${uf.toUpperCase()}`" @pick="open")
  .legend-row
    span.key(v-for="l in legend" :key="l.party")
      i.sw(:style="{ background: partyColor(l.party) }")
      | {{ office === 1 ? l.name : l.party }} · {{ l.n }}
  p.muted Fonte: TSE, IBGE.
</template>
