<script setup vapor>
import { computed } from 'vue'
import { partyColor } from '../colors'
import { pct } from '../format'

// Tile-grid cartogram: one square per state, so small states are as visible as large ones. rows = stateWinners() rows.
const props = defineProps({ rows: Array })
const emit = defineEmits(['pick'])
const GRID = {
  rr: [2, 0], ap: [4, 0], am: [1, 1], pa: [3, 1], ma: [4, 1], ce: [5, 1], rn: [6, 1], ac: [0, 2], ro: [1, 2], mt: [2, 2], to: [3, 2],
  pi: [4, 2], pe: [5, 2], pb: [6, 2], ms: [1, 3], go: [2, 3], df: [3, 3], ba: [4, 3], se: [5, 3], al: [6, 3], sp: [2, 4], mg: [3, 4],
  es: [4, 4], pr: [2, 5], rj: [3, 5], sc: [2, 6], rs: [2, 7],
}
const S = 46
const GAP = 4
const tiles = computed(() => props.rows.filter((r) => r.rn === 1 && GRID[r.state]).map((r) => {
  const second = props.rows.find((x) => x.state === r.state && x.rn === 2)
  const margin = (r.votes - (second?.votes ?? 0)) / r.valid
  return { uf: r.state, x: GRID[r.state][0] * (S + GAP), y: GRID[r.state][1] * (S + GAP), color: partyColor(r.party), opacity: 0.4 + 0.6 * Math.min(margin / 0.3, 1),
    text: `${r.state.toUpperCase()}: ${r.name ?? r.cand} ${pct(r.votes / r.valid, 1)}${second ? `, ${second.name ?? second.cand} ${pct(second.votes / r.valid, 1)}` : ''}` }
}))
const key = (e, uf) => (e.key === 'Enter' || e.key === ' ') && emit('pick', uf)
</script>

<template lang="pug">
svg.tiles(viewBox="0 0 370 400" role="group" aria-label="Cartograma: um quadrado por estado, colorido pelo candidato mais votado")
  g.tile(v-for="t in tiles" :key="t.uf" tabindex="0" role="button" :aria-label="t.text" @click="emit('pick', t.uf)" @keydown="key($event, t.uf)")
    rect(:x="t.x" :y="t.y" :width="46" :height="46" rx="6" :fill="t.color" :fill-opacity="t.opacity")
    text(:x="t.x + 23" :y="t.y + 28" text-anchor="middle") {{ t.uf.toUpperCase() }}
    title {{ t.text }}
</template>
