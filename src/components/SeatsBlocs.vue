<script setup vapor>
import { computed } from 'vue'
import { t } from '../i18n'
import { int, pct } from '../format'
import { blocLabel, useSort } from '../seats/present'
import DataTable from './DataTable.vue'
import Notice from './Notice.vue'

// Step 2: votes of each list (nominal + legend), its quociente partidário (CE art. 107) and the seats that fill by it (art. 108: the
// individual minimum). `check` is the same quotients computed in SQL.
const props = defineProps({ result: Object, unit: String, check: Array })
const all = computed(() => props.result.blocs.map((b) => ({
  bloc: blocLabel(b, props.unit), votes: b.votes, nominal: b.nominal, legend: b.legend, share: b.votes / props.result.quotient.value, qp: b.qp,
  filled: b.elected.filter((c) => c.seat.kind === 'qp').length, released: b.released,
})))
const { sort, sorted, flip } = useSort(all, { key: 'votes', dir: 'desc' })
const cols = computed(() => [
  { key: 'bloc', label: t('seats.blocs.list'), sortable: true },
  { key: 'nominal', label: t('seats.blocs.nominal'), num: true, fmt: int, sortable: true },
  { key: 'legend', label: t('seats.blocs.legend'), num: true, fmt: int, sortable: true },
  { key: 'votes', label: t('seats.blocs.votes'), num: true, fmt: int, sortable: true },
  { key: 'share', label: t('seats.blocs.share'), num: true, fmt: (v) => pct(v, 0), sortable: true },
  { key: 'qp', label: t('seats.blocs.qp'), num: true, fmt: int, sortable: true },
  { key: 'filled', label: t('seats.blocs.filled'), num: true, fmt: int, sortable: true },
  { key: 'released', label: t('seats.blocs.released'), num: true, fmt: int, sortable: true },
])
const agrees = (c) => { const b = props.result.blocs.find((x) => x.bloc === c.bloc); return b?.votes === c.votes && b.qp === c.qp }
const same = computed(() => props.check?.length === props.result.blocs.length && props.check[0].qe === props.result.quotient.value && props.check.every(agrees))
const released = computed(() => props.result.blocs.reduce((n, b) => n + b.released, 0))
</script>

<template lang="pug">
DataTable(:columns="cols" :rows="sorted" :sort="sort" @sort="flip")
p.muted(v-if="released") {{ t('seats.blocs.releasedNote', { count: released }) }}
template(v-if="check")
  Notice(v-if="same" kind="success") {{ t('seats.blocs.sqlSame') }}
  Notice(v-else kind="danger") {{ t('seats.blocs.sqlDiffers') }}
</template>
