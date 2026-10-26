<script setup vapor>
import { computed } from 'vue'
import { route, setParam } from '../router'
import { useAsync } from '../use'
import { t } from '../i18n'
import { bytes, int } from '../format'
import Panel from '../components/Panel.vue'
import Field from '../components/Field.vue'

const catalog = useAsync(() => [], async () => {
  const response = await fetch(`${import.meta.env.BASE_URL}data/history/catalog.json`)
  if (!response.ok) throw new Error(t('errors.http', { url: 'history/catalog.json', status: response.status }))
  return response.json()
})
const year = computed(() => route.value.params.get('year') ?? '')
const family = computed(() => route.value.params.get('family') ?? '')
const years = computed(() => [...new Set(catalog.data?.datasets.flatMap((d) => d.years) ?? [])].sort((a,b) => a-b))
const families = computed(() => [...new Set(catalog.data?.datasets.map((d) => d.family) ?? [])].sort())
const datasets = computed(() => catalog.data?.datasets.filter((d) => d.inScope !== false && (!year.value || d.years.includes(+year.value)) && (!family.value || d.family === family.value)) ?? [])
const pick = (key, e) => setParam(key,e.target.value)
const status = (value) => t(`history.status.${value}`)
</script>

<template lang="pug">
h1 {{ t('history.title') }}
p.muted {{ t('history.intro') }}
Panel(:title="t('history.catalog')" :state="catalog" :election="route.election" wide)
  p {{ t('history.summary', { first: catalog.data.earliestYear, datasets: int(catalog.data.datasetCount), resources: int(catalog.data.resourceCount) }) }}
  .cluster
    Field(:label="t('election.year')")
      select(:value="year" @change="pick('year', $event)")
        option(value="") {{ t('history.allYears') }}
        option(v-for="y in years" :key="y" :value="y") {{ y }}
    Field(:label="t('history.family')")
      select(:value="family" @change="pick('family', $event)")
        option(value="") {{ t('history.allFamilies') }}
        option(v-for="f in families" :key="f" :value="f") {{ f }}
  details(v-for="dataset in datasets" :key="dataset.id")
    summary {{ dataset.title }} · {{ status(dataset.status) }}
    p.muted {{ t(dataset.normalized ? 'history.normalized' : 'history.notNormalized') }}
    .cluster
      a(:href="dataset.source" target="_blank" rel="noopener") {{ t('history.source') }}
      a(v-if="dataset.status === 'published' || (dataset.status === 'partial' && dataset.publicationVerifiedAt)" :href="dataset.releaseUrl" target="_blank" rel="noopener") {{ t('history.release') }}
    .table-wrap
      table.table
        thead
          tr
            th {{ t('history.resource') }}
            th {{ t('history.state') }}
            th {{ t('history.size') }}
        tbody
          tr(v-for="resource in dataset.resources" :key="resource.id")
            td
              a(:href="resource.url" target="_blank" rel="noopener") {{ resource.name }}
            td {{ status(resource.status) }}
            td {{ resource.bytes == null ? '–' : bytes(resource.bytes) }}
</template>
