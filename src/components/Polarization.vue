<script setup vapor>
import { computed } from 'vue'
import { partyColor } from '../colors'
import { pct } from '../format'
import { t } from '../i18n'
import { electionLabel } from '../labels'
import { titleCase } from '../results'

// Two circles per election, area proportional to the share of valid (nominal) votes: rows = [{ election, a, b }],
// where a and b are { name, party, share } of the two leaders. Up to three elections per line.
const props = defineProps({ rows: Array })
const K = 60 / Math.sqrt(0.6) // radius of a 60% circle is 60
const W = 280
const H = 190
const COLUMNS = 3
const circles = computed(() => props.rows.map((row, i) => ({
  ...row, x: (i % COLUMNS) * W, y: Math.floor(i / COLUMNS) * H,
  items: [row.a, row.b].map((c, j) => ({ ...c, cx: W * 0.27 + j * W * 0.46, r: K * Math.sqrt(c.share), color: partyColor(c.party), label: titleCase(c.name) })),
})))
</script>

<template lang="pug">
svg.polar(:viewBox="`0 0 ${Math.min(rows.length, COLUMNS) * W} ${Math.ceil(rows.length / COLUMNS) * H}`" role="img" :aria-label="t('overview.polarizationLabel')")
  g(v-for="c in circles" :key="c.election" :transform="`translate(${c.x} ${c.y})`")
    text.polar__caption(:x="W / 2" y="14" text-anchor="middle") {{ electionLabel(c.election) }}
    g(v-for="(it, j) in c.items" :key="j")
      text.polar__name(:x="it.cx" y="34" text-anchor="middle") {{ it.label }}
      text.polar__party(:x="it.cx" y="48" text-anchor="middle") {{ it.party }}
      circle(:cx="it.cx" :cy="125" :r="it.r" :style="{ fill: it.color }")
      text.polar__value(:x="it.cx" :y="130" text-anchor="middle") {{ pct(it.share, 1) }}
</template>
