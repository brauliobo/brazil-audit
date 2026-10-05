<script setup vapor>
import { int, num } from '../format'
import Chart from './Chart.vue'
import { t } from '../i18n'
import { FLAG } from './keys'

// Small multiples: the same scope for every candidate or total of the office; items = [{ cand, label, result }].
defineProps({ items: Array, link: Function })
const ARROW = { above: '▲', below: '▼' }
const caption = (r) => [
  t('benford.multiples.n', { n: int(r.n) }),
  r.mad != null && `${t('benford.stats.mad')} ${num(r.mad, 4)}`,
  ARROW[r.verdict] ? `${ARROW[r.verdict]} ${t(FLAG[r.verdict])}` : r.small && t('benford.heatmap.small'),
].filter(Boolean).join(' · ')
</script>

<template lang="pug">
p.muted {{ t('benford.multiples.note') }}
p(v-if="!items.length") {{ t('benford.multiples.empty') }}
ul.bf-multiples
  li(v-for="it in items" :key="it.cand")
    a(:href="link(it.cand)")
      strong {{ it.label }}
    Chart(:result="it.result" :title="it.label" compact)
    small.muted {{ caption(it.result) }}
</template>
