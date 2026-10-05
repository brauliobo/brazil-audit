<script setup vapor>
import { computed, ref } from 'vue'
import DataTable from '../components/DataTable.vue'
import { href } from '../router'
import { int, num, pct } from '../format'
import { stateTitle } from '../labels'
import { locale, t } from '../i18n'
import { FLAG } from './keys'

// Places (UFs or municipalities) ordered by the baseline-adjusted deviation, with N, and links to the drill-down.
const props = defineProps({ places: Array, election: String, office: Number, here: Function })
const SIZE = 25
const sort = ref({ key: 'index', dir: 'desc' })
const page = ref(0)
const SIDE = { above: 'above', below: 'below', inside: 'inside', nobase: 'none' }
const rows = computed(() => props.places.filter((p) => !p.result.small).map((p) => ({
  uf: p.uf, city: p.city, n: p.result.n, mad: p.result.mad, base: p.result.baseline?.mad.mean ?? null, index: p.result.index, excess: p.result.excess,
  flag: t(FLAG[SIDE[p.result.verdict]]), place: p.city ? `${p.city} (${p.uf.toUpperCase()})` : stateTitle(p.uf),
})))
const sorted = computed(() => {
  const { key, dir } = sort.value
  const sign = dir === 'asc' ? 1 : -1
  return rows.value.toSorted((a, b) => (a[key] == null) - (b[key] == null) || sign * (typeof a[key] === 'string' ? a[key].localeCompare(b[key], locale.value) : a[key] - b[key]))
})
const shown = computed(() => sorted.value.slice(page.value * SIZE, (page.value + 1) * SIZE))
const order = (key) => { sort.value = { key, dir: sort.value.key === key && sort.value.dir === 'desc' ? 'asc' : 'desc' }; page.value = 0 }
const columns = computed(() => [
  { key: 'place', label: t('benford.controls.place'), sortable: true, href: (r) => props.here(r.city ? `${r.uf}/${r.city}` : r.uf) },
  { key: 'n', label: t('benford.ranking.n'), num: true, fmt: int, sortable: true },
  { key: 'mad', label: t('benford.ranking.mad'), num: true, fmt: (v) => num(v, 4), sortable: true },
  { key: 'base', label: t('benford.ranking.base'), num: true, fmt: (v) => (v == null ? '–' : num(v, 4)), sortable: true },
  { key: 'excess', label: t('benford.ranking.excess'), num: true, fmt: (v) => (v == null ? '–' : pct(v, 1)), sortable: true },
  { key: 'index', label: t('benford.ranking.index'), num: true, fmt: (v) => (v == null ? '–' : num(v, 1)), sortable: true },
  { key: 'flag', label: t('benford.ranking.flag') },
  { key: 'drill', label: t('benford.ranking.detail'), fmt: () => t('benford.ranking.open'), href: (r) => href(props.election, 'drill', r.city ? [r.uf, r.city] : [r.uf], { office: props.office }) },
])
</script>

<template lang="pug">
p.muted {{ t('benford.ranking.note') }}
p(v-if="!rows.length") {{ t('benford.ranking.empty') }}
template(v-else)
  DataTable(:columns="columns" :rows="shown" :sort="sort" :page="page" :size="SIZE" :total="rows.length" @sort="order" @page="page = $event")
  p.muted {{ t('benford.ranking.shown', { shown: int(shown.length), total: int(rows.length) }) }}
</template>
