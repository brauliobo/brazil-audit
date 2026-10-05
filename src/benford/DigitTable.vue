<script setup vapor>
import { computed, ref } from 'vue'
import { int, num, pct } from '../format'
import Button from '../components/Button.vue'
import { t } from '../i18n'
import { FLAG } from './keys'

// The numbers behind the chart as a real table, with a copy button (tab separated, ready for a spreadsheet).
const props = defineProps({ result: Object })
const copied = ref(false)
const r = computed(() => props.result)
const SIDE = { 1: 'above', '-1': 'below', 0: 'inside' }
const rows = computed(() => r.value.digits.map((d, i) => {
  const b = r.value.baseline?.digits?.[i]
  return { d, n: r.value.counts[i], obs: r.value.props[i], law: r.value.probs[i], b, z: r.value.z[i].z, flag: b ? t(FLAG[SIDE[r.value.outside[i]]]) : t(FLAG.none) }
}))
const pc = (v) => (v == null ? '–' : pct(v, 2))
const tsv = computed(() => [
  [t('benford.table.digit'), t('benford.table.count'), t('benford.table.observed'), t('benford.table.law'), t('benford.table.base'), t('benford.table.lo'), t('benford.table.hi'), t('benford.table.z'), t('benford.table.flag')],
  ...rows.value.map((x) => [x.d, x.n, pc(x.obs), pc(x.law), pc(x.b?.mean), pc(x.b?.lo), pc(x.b?.hi), num(x.z, 2), x.flag]),
].map((l) => l.join('\t')).join('\n'))

async function copy() {
  await navigator.clipboard.writeText(tsv.value)
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}
</script>

<template lang="pug">
.bf-table
  .table-wrap(tabindex="0" role="region" :aria-label="t('benford.table.caption')")
    table.table
      caption {{ t('benford.table.caption') }}
      thead
        tr
          th(scope="col") {{ t('benford.table.digit') }}
          th.num(scope="col") {{ t('benford.table.count') }}
          th.num(scope="col") {{ t('benford.table.observed') }}
          th.num(scope="col") {{ t('benford.table.law') }}
          th.num(scope="col") {{ t('benford.table.base') }}
          th.num(scope="col") {{ t('benford.table.lo') }}
          th.num(scope="col") {{ t('benford.table.hi') }}
          th.num(scope="col" :title="t('benford.table.zHint')") {{ t('benford.table.z') }}
          th(scope="col") {{ t('benford.table.flag') }}
      tbody
        tr(v-for="x in rows" :key="x.d")
          th(scope="row") {{ x.d }}
          td.num {{ int(x.n) }}
          td.num {{ pc(x.obs) }}
          td.num {{ pc(x.law) }}
          td.num {{ pc(x.b?.mean) }}
          td.num {{ pc(x.b?.lo) }}
          td.num {{ pc(x.b?.hi) }}
          td.num {{ num(x.z, 2) }}
          td {{ x.flag }}
  Button(variant="ghost" @click="copy") {{ copied ? t('benford.table.copied') : t('benford.table.copy') }}
</template>
