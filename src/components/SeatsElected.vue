<script setup vapor>
import { computed } from 'vue'
import { t } from '../i18n'
import { int, pct } from '../format'
import { blocLabel, candidateName, how } from '../seats/present'
import DataTable from './DataTable.vue'

// Step 4: the candidates of each list in the order of their votes: who takes the seats it won (quociente or sobras), and who comes
// next on the list (the suplentes, CE art. 112) with the votes that separate them from the last elected.
const props = defineProps({ result: Object, unit: String, names: Object, uf: String, official: Array })
const elected = computed(() => props.result.blocs.flatMap((b) => b.elected.map((c) => ({ ...c, bloc: blocLabel(b, props.unit) }))))
const listed = computed(() => new Set((props.official ?? []).map((c) => c.n)))
const name = (n) => `${candidateName(props.names, props.uf, n)} · ${n}`
const cols = computed(() => [
  { key: 'bloc', label: t('seats.blocs.list') },
  { key: 'n', label: t('seats.elected.candidate'), fmt: name },
  { key: 'votes', label: t('common.votes'), num: true, fmt: int },
  { key: 'share', label: t('seats.elected.share'), num: true, fmt: (v) => pct(v, 0) },
  { key: 'seat', label: t('seats.elected.how'), fmt: how },
  { key: 'official', label: t('seats.elected.official'), fmt: (v) => (v ? t('seats.elected.listed') : t('seats.elected.unlisted')) },
])
const rows = computed(() => elected.value.map((c) => ({ ...c, share: c.votes / props.result.quotient.value, official: listed.value.has(c.n) })))
const next = computed(() => props.result.blocs.filter((b) => b.elected.length && b.next).map((b) => ({ bloc: blocLabel(b, props.unit), ...b.next })))
const nextCols = computed(() => [
  { key: 'bloc', label: t('seats.blocs.list') },
  { key: 'n', label: t('seats.elected.candidate'), fmt: name },
  { key: 'votes', label: t('common.votes'), num: true, fmt: int },
  { key: 'behind', label: t('seats.elected.behind'), num: true, fmt: int },
])
</script>

<template lang="pug">
DataTable(:columns="cols" :rows="rows")
h3 {{ t('seats.elected.nextTitle') }}
p.muted {{ t('seats.elected.nextNote') }}
DataTable(:columns="nextCols" :rows="next")
</template>
