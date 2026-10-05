<script setup vapor>
import { computed } from 'vue'
import { partyColor } from '../colors'
import { pct } from '../format'
import { titleCase } from '../results'

// Two circles per election, area proportional to the share of valid (nominal) votes: rows = [{ election, a, b }],
// where a and b are { name, party, share } of the two leaders.
const props = defineProps({ rows: Array })
const K = 60 / Math.sqrt(0.6) // radius of a 60% circle is 60
const W = 280
const circles = computed(() => props.rows.map((row, i) => ({
  ...row, x: i * W,
  items: [row.a, row.b].map((c, j) => ({ ...c, cx: W * 0.27 + j * W * 0.46, r: K * Math.sqrt(c.share), color: partyColor(c.party), label: titleCase(c.name) })),
})))
</script>

<template lang="pug">
svg.polar(:viewBox="`0 0 ${rows.length * W} 190`" role="img" aria-label="Polarização: participação dos dois candidatos mais votados nos votos válidos, círculos com área proporcional")
  g(v-for="c in circles" :key="c.election" :transform="`translate(${c.x} 0)`")
    text.cap(:x="W / 2" y="14" text-anchor="middle") {{ c.election }}
    g(v-for="(it, j) in c.items" :key="j")
      text.who(:x="it.cx" y="34" text-anchor="middle") {{ it.label }}
      text.who.dim(:x="it.cx" y="48" text-anchor="middle") {{ it.party }}
      circle(:cx="it.cx" :cy="125" :r="it.r" :fill="it.color")
      text.pct(:x="it.cx" :y="130" text-anchor="middle") {{ pct(it.share, 1) }}
</template>
