<script setup vapor>
import { computed } from 'vue'
import index from '../../data/history/indicators.json'
import { cachedFetch,gunzip } from '../db/fetching'
import { HISTORICAL_METRICS,historicalValue,parseHistoricalCsv } from '../history-comparison'
import { route,setParam } from '../router'
import { useAsync } from '../use'
import { t } from '../i18n'
import { int,pct } from '../format'
import Field from './Field.vue'
import Panel from './Panel.vue'
import DataTable from './DataTable.vue'
const offices = [...new Map(index.elections.flatMap((e) => e.offices).map((o) => [o.key,o])).values()]
const office = computed(() => route.value.params.get('history_office') ?? offices[0]?.key)
const metric = computed(() => HISTORICAL_METRICS.includes(route.value.params.get('history_metric')) ? route.value.params.get('history_metric') : 'abstention_rate')
const state = computed(() => route.value.params.get('history_state') ?? '')
const loads = new Map()
async function load(e) {
  if (!loads.has(e.id)) loads.set(e.id,Promise.all(e.parts.map(async (part) => {
    const res = await cachedFetch(`${import.meta.env.BASE_URL}data/${part.url}`,part.sha256)
    return parseHistoricalCsv(await new Response(gunzip(res)).text())
  })).then((parts) => parts.flat()))
  return loads.get(e.id)
}
const data = useAsync(() => [office.value,metric.value,state.value],async ([cargo,id,uf]) => {
  const elections = index.elections.filter((e) => e.offices.some((o) => o.key === cargo))
  const rows = []
  for (const e of elections) rows.push({election:`${e.year} · ${e.turn ?? '–'} · ${e.description || e.id}`, yearConflict:e.yearDateConflict ? t('compare.historyYearConflict') : null,dates:e.dates?.join(', '),types:e.electionTypes?.join(', '),sourceYears:e.sourceDatasetYears?.join(', '),...historicalValue(await load(e),id,cargo,uf)})
  return rows
})
const sources = computed(() => [...new Set(index.elections.filter((e) => e.offices.some((o) => o.key === office.value)).flatMap((e) => e.sources))])
const show = (v) => v == null ? '–' : metric.value.endsWith('_rate') ? pct(v,2) : int(v)
const columns = computed(() => [
  {key:'election',label:t('compare.election')},
  {key:'value',label:t('compare.value'),fmt:show,num:true},
  {key:'numerator',label:t('compare.numerator'),fmt:int,num:true},
  {key:'denominator',label:t('compare.denominator'),fmt:int,num:true},
  {key:'yearConflict',label:t('compare.historyContext')},
  {key:'dates',label:t('compare.historyDates')},
  {key:'types',label:t('compare.historyTypes')},
  {key:'sourceYears',label:t('compare.historySourceYears')},
  {key:'scope',label:t('compare.historyGrain')},
  {key:'units',label:t('compare.historyKnown'),fmt:int,num:true},
  {key:'totalUnits',label:t('compare.historyTotal'),fmt:int,num:true},
  {key:'states',label:t('compare.historyStates')},
])
</script>
<template lang="pug">
p.muted {{ t('compare.historyNote') }}
.cluster
  Field(:label="t('common.office')")
    select(:value="office" @change="setParam('history_office',$event.target.value)")
      option(v-for="o in offices" :key="o.key" :value="o.key") {{ o.name || t('compare.unknownOffice') }} · {{ o.key }}
  Field(:label="t('compare.indicator')")
    select(:value="metric" @change="setParam('history_metric',$event.target.value)")
      option(v-for="id in HISTORICAL_METRICS" :key="id" :value="id") {{ t(`compare.metrics.${id}`) }}
  Field(:label="t('compare.historyState')")
    input(:value="state" placeholder="SP" maxlength="2" @change="setParam('history_state',$event.target.value.toLowerCase())")
Panel(:title="t('compare.historyMode')" :state="data" wide)
  DataTable(:columns="columns" :rows="data.data")
  details
    summary {{ t('compare.source') }}
    ul
      li(v-for="url in sources" :key="url")
        a(:href="url" target="_blank" rel="noopener noreferrer") {{ url }}
</template>
