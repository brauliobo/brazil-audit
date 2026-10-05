<script setup vapor>
import { computed } from 'vue'
import { href } from '../router'
import { t } from '../i18n'
import { stateTitle } from '../labels'
import { int, pct } from '../format'
import { compare } from '../seats/calc'
import { seatGroups, useSort } from '../seats/present'
import DataTable from './DataTable.vue'
import Hemicycle from './Hemicycle.vue'

// The federal chamber as the sum of the UFs: each UF is calculated on its own (own quociente eleitoral), the hemicycle adds them up.
// `votesBehind` is how close the last seat of a UF was decided (a small number: a partial count could still change it).
const props = defineProps({ results: Map, inputs: Map, official: Map, unit: String, election: String, office: Number, params: Object })
const groups = computed(() => seatGroups([...props.results.values()], { unit: props.unit, national: true }))
const total = computed(() => groups.value.reduce((n, g) => n + g.seats, 0))
const all = computed(() => [...props.results].map(([uf, r]) => {
  const d = compare(r, (props.official.get(uf) ?? []).map((c) => c.n))
  return { uf, seats: r.seats, votes: r.validVotes, quotient: r.quotient.value, differs: d.onlyOfficial.length, share: r.validVotes / props.inputs.get(uf).officialVotes, behind: r.lastSeat?.votesBehind }
}))
const { sort, sorted, flip } = useSort(all, { key: 'uf', dir: 'asc' })
const cols = computed(() => [
  { key: 'uf', label: t('common.state'), sortable: true, fmt: stateTitle, href: (r) => href(props.election, 'seats', [], { ...props.params, uf: r.uf }) },
  { key: 'seats', label: t('seats.national.seats'), num: true, fmt: int, sortable: true },
  { key: 'votes', label: t('seats.blocs.votes'), num: true, fmt: int, sortable: true },
  { key: 'quotient', label: t('seats.national.quotient'), num: true, fmt: int, sortable: true },
  { key: 'differs', label: t('seats.national.official'), num: true, fmt: (v) => (v ? t('seats.national.differs', { count: v }) : t('seats.national.same')), sortable: true },
  { key: 'share', label: t('seats.national.counted'), num: true, fmt: (v) => pct(v, 1), sortable: true },
  { key: 'behind', label: t('seats.national.behind'), num: true, fmt: int, sortable: true },
])
</script>

<template lang="pug">
Hemicycle(:groups="groups" :label="t('seats.national.label', { count: total })")
p.muted {{ t('seats.national.note') }}
DataTable(:columns="cols" :rows="sorted" :sort="sort" @sort="flip")
</template>
