<script setup vapor>
import { computed, ref } from 'vue'
import { ELECTIONS } from '../model'
import { ensure, store } from '../data'
import { useAsync } from '../use'
import { objects } from '../db'
import { int } from '../format'
import { t } from '../i18n'
import { profileBreakdownQuery, profileOptionsQuery, profilePlacesQuery } from '../election-profiles'
import Field from './Field.vue'
import Panel from './Panel.vue'
import Notice from './Notice.vue'
import BarList from './BarList.vue'
import DataTable from './DataTable.vue'

const props = defineProps({ election: String })
const selectedDataset = ref(''), selectedYear = ref(null), selectedTurn = ref(null), selectedState = ref('ac')
const selectedAxis = ref('gender'), selectedMetric = ref('eligible'), detail = ref(false), city = ref(''), zone = ref('')
const filterAxis = ref('age'), filterValue = ref(''), filters = ref({})
const metadata = useAsync(() => [], async () => {
  const response = await fetch(`${import.meta.env.BASE_URL}data/profiles/index.json`, { cache: 'no-cache' })
  if (!response.ok) throw new Error(t('errors.http', { url: 'profiles/index.json', status: response.status }))
  return response.json()
})
const datasets = computed(() => metadata.data?.datasets ?? [])
const contextYear = computed(() => ELECTIONS[props.election].sourceSession?.sourceYears[0] ?? ELECTIONS[props.election].year)
const dataset = computed(() => datasets.value.find((d) => d.datasetId === selectedDataset.value)
  ?? datasets.value.find((d) => d.years.includes(contextYear.value)) ?? datasets.value[0])
const year = computed(() => dataset.value?.years.includes(Number(selectedYear.value)) ? Number(selectedYear.value) : dataset.value?.years[0])
const turns = computed(() => dataset.value?.turns ?? [])
const turn = computed(() => turns.value.includes(Number(selectedTurn.value)) ? Number(selectedTurn.value) : turns.value[0] ?? null)
const axis = computed(() => dataset.value?.axes.includes(selectedAxis.value) ? selectedAxis.value : dataset.value?.axes[0])
const metric = computed(() => dataset.value?.metrics.includes(selectedMetric.value) ? selectedMetric.value : dataset.value?.metrics[0])
const availableParts = computed(() => Object.entries(store.manifest.tables.election_profiles?.parts ?? {}).filter(([,p]) => p.datasetId === dataset.value?.datasetId))
const states = computed(() => [...new Set(availableParts.value.map(([,p]) => p.state))].filter(Boolean).sort())
const state = computed(() => states.value.includes(selectedState.value) ? selectedState.value : states.value[0])
const level = computed(() => detail.value ? 'detail' : 'state')
const scope = computed(() => ({ dataset_id: dataset.value?.datasetId, year: year.value, turn: turn.value, level: level.value,
  state: state.value, city_code: detail.value ? city.value : '', zone: detail.value ? zone.value : '', filters: filters.value }))
const loaded = useAsync(() => [dataset.value?.datasetId, state.value, level.value], async () => {
  if (!dataset.value || !state.value) return null
  const ids = availableParts.value.filter(([,p]) => p.state === state.value && p.level === level.value).map(([id]) => id)
  await ensure('election_profiles', ids)
  return true
})
const query = computed(() => axis.value && metric.value ? profileBreakdownQuery(scope.value, axis.value, metric.value) : null)
const results = useAsync(() => [JSON.stringify(scope.value), axis.value, metric.value, loaded.loading], async (_, q) => {
  if (loaded.loading || !loaded.data || !query.value) return null
  return objects(await q(query.value.sql, query.value.params))
})
const places = useAsync(() => [dataset.value?.datasetId, year.value, turn.value, state.value, detail.value, loaded.loading], async (_, q) => {
  if (!detail.value || loaded.loading || !loaded.data) return []
  const query = profilePlacesQuery(scope.value)
  return objects(await q(query.sql, query.params))
})
const options = useAsync(() => [JSON.stringify(scope.value), filterAxis.value, loaded.loading], async (_, q) => {
  if (loaded.loading || !loaded.data || !dataset.value?.axes.includes(filterAxis.value)) return []
  const query = profileOptionsQuery({ ...scope.value, filters: {} }, filterAxis.value)
  return objects(await q(query.sql, query.params))
})
const addFilter = () => { if (filterValue.value !== '') filters.value = { ...filters.value, [filterAxis.value]: filterValue.value } }
const removeFilter = (name) => { const next = { ...filters.value }; delete next[name]; filters.value = next }
const resetDataset = (event) => { selectedDataset.value = event.target.value; selectedYear.value = null; selectedTurn.value = null; filters.value = {}; city.value = ''; zone.value = '' }
const bars = computed(() => (results.data ?? []).filter((r) => r.value != null).map((r) => ({ label: r.label ?? t('profiles.unknown'), value: Number(r.value), text: int(r.value) })))
const columns = computed(() => [
  { key: 'label', label: t('profiles.category'), fmt: (v) => v ?? t('profiles.unknown') },
  { key: 'value', label: t(`profiles.metrics.${metric.value}`), num: true, fmt: int },
  { key: 'known_value', label: t('profiles.knownValue'), num: true, fmt: int },
  { key: 'known_cells', label: t('profiles.knownCells'), num: true, fmt: int },
  { key: 'cells', label: t('profiles.cells'), num: true, fmt: int },
])
const cities = computed(() => [...new Map((places.data ?? []).filter((r) => r.city_code).map((r) => [r.city_code, r.city_name])).entries()])
const zones = computed(() => [...new Set((places.data ?? []).filter((r) => !city.value || r.city_code === city.value).map((r) => r.zone))].filter(Boolean))
</script>
<template lang="pug">
h2 {{ t('profiles.title') }}
Notice(v-if="metadata.error" kind="warning") {{ metadata.error.message }}
Notice(v-if="loaded.error" kind="warning") {{ loaded.error.message }}
Notice {{ t('profiles.snapshot') }}
p.muted(v-if="dataset && year !== contextYear") {{ t('profiles.differentYear', { year, context: contextYear }) }}
.cluster
  Field(:label="t('profiles.source')")
    select(:value="dataset?.datasetId" @change="resetDataset")
      option(v-for="d in datasets" :key="d.datasetId" :value="d.datasetId") {{ d.datasetId }}
  Field(:label="t('profiles.year')")
    select(:value="year" @change="selectedYear = Number($event.target.value)")
      option(v-for="y in dataset?.years ?? []" :key="y" :value="y" :selected="y === year") {{ y }}
  Field(:label="t('profiles.turn')")
    select(:value="turn" @change="selectedTurn = Number($event.target.value)")
      option(v-if="!turns.length" :value="null") {{ t('profiles.snapshotTurn') }}
      option(v-for="n in turns" :key="n" :value="n" :selected="n === turn") {{ n }}
  Field(:label="t('common.state')")
    select(:value="state" @change="selectedState = $event.target.value")
      option(v-for="s in states" :key="s" :value="s") {{ s.toUpperCase() }}
  Field(:label="t('profiles.axis')")
    select(:value="axis" @change="selectedAxis = $event.target.value")
      option(v-for="a in dataset?.axes ?? []" :key="a" :value="a") {{ t(`profiles.axes.${a}`) }}
  Field(:label="t('profiles.metric')")
    select(:value="metric" @change="selectedMetric = $event.target.value")
      option(v-for="m in dataset?.metrics ?? []" :key="m" :value="m") {{ t(`profiles.metrics.${m}`) }}
label
  input(type="checkbox" v-model="detail")
  | {{ t('profiles.loadDetail') }}
.cluster(v-if="detail")
  Field(:label="t('common.city')")
    select(v-model="city" @change="zone = ''")
      option(value="") {{ t('profiles.allCities') }}
      option(v-for="[code,name] in cities" :key="code" :value="code") {{ name }} · {{ code }}
  Field(:label="t('common.zone')")
    select(v-model="zone")
      option(value="") {{ t('profiles.allZones') }}
      option(v-for="z in zones" :key="z" :value="z") {{ z }}
details
  summary {{ t('profiles.filters') }}
  .cluster
    Field(:label="t('profiles.axis')")
      select(v-model="filterAxis")
        option(v-for="a in dataset?.axes ?? []" :key="a" :value="a") {{ t(`profiles.axes.${a}`) }}
    Field(:label="t('profiles.category')")
      select(v-model="filterValue")
        option(value="") {{ t('profiles.choose') }}
        option(v-for="r in options.data ?? []" :key="r.code" :value="r.code" :disabled="r.code == null") {{ r.label ?? t('profiles.unknown') }}
    button(type="button" @click="addFilter") {{ t('profiles.addFilter') }}
  .cluster
    button(v-for="(value,name) in filters" :key="name" type="button" @click="removeFilter(name)") {{ t(`profiles.axes.${name}`) }} · {{ value }} ×
Panel(:title="t('profiles.breakdown')" :state="results" :election="election" wide)
  BarList(:items="bars")
  Notice(v-if="results.data?.some(r => r.value == null)") {{ t('profiles.partial') }}
  DataTable(:columns="columns" :rows="results.data ?? []")
  p.muted {{ t('profiles.grain', { level }) }}
  p(v-if="dataset")
    a(:href="dataset.sourceUrl" target="_blank" rel="noopener") {{ t('profiles.original') }}
    code {{ dataset.sourceSha256 }}
  details(v-if="query")
    summary {{ t('common.openInConsole') }}
    pre {{ query.sql }}
    pre {{ JSON.stringify(query.params) }}
</template>
