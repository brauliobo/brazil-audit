<script setup vapor>
import { computed } from 'vue'
import { route,setParam } from '../router'
import { useAsync } from '../use'
import { t } from '../i18n'
import { int,pct } from '../format'
import Panel from './Panel.vue'
import Field from './Field.vue'
import DataTable from './DataTable.vue'
const indexes = import.meta.glob('../../data/transfers/index.json',{eager:true,import:'default'})
const index = Object.values(indexes)[0]
const contests = computed(() => index?.contests ?? [])
const selected = computed(() => contests.value.find((c) => c.id === route.value.params.get('contest')) ?? contests.value[0])
const data = useAsync(() => [selected.value?.id],async () => {
  const contest = selected.value
  if (!contest?.url) return null
  const res = await fetch(`${import.meta.env.BASE_URL}data/${contest.url}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
})
const rows = computed(() => {
  const d = data.data
  return d?.cells?.map((c) => ({...c,fromLabel:d.from.find((r) => r.id===c.from)?.label ?? c.from,toLabel:d.to.find((r) => r.id===c.to)?.label ?? c.to,interval:c.low==null?'–':`${int(c.low)} – ${int(c.high)}`,bounds:`${int(c.boundLow)} – ${int(c.boundHigh)}`})) ?? []
})
const columns = computed(() => [
  {key:'fromLabel',label:t('compare.flowFrom')},{key:'toLabel',label:t('compare.flowTo')},
  {key:'estimate',label:t('compare.flowEstimate'),num:true,fmt:int},
  {key:'rowShare',label:t('compare.flowShare'),num:true,fmt:(v)=>v==null?'–':pct(v,2)},
  {key:'interval',label:t('compare.flowInterval')},{key:'bounds',label:t('compare.flowBounds')},
])
</script>
<template lang="pug">
p.muted {{ t('compare.flowNote') }}
p(v-if="!contests.length") {{ t('compare.flowPending') }}
Field(v-else :label="t('compare.election')")
  select(:value="selected.id" @change="setParam('contest',$event.target.value)")
    option(v-for="c in contests" :key="c.id" :value="c.id") {{ c.year }} · {{ c.office }} · {{ c.state }} · {{ c.city ?? '' }}
Panel(v-if="selected" :title="t('compare.flowMode')" :state="data" wide)
  template(v-if="data.data")
    p {{ t(`compare.flowStatus.${data.data.status}`) }}
    p(v-if="data.data.reason") {{ t(`compare.flowReasons.${data.data.reason}`) }}
    p {{ t('compare.flowCoverage', { units: int(data.data.coverage.units), total: int(data.data.coverage.eligibleUnits), electorate: int(data.data.coverage.electorate), all: int(data.data.coverage.electorateTotal) }) }}
    DataTable(:columns="columns" :rows="rows")
    details
      summary {{ t('compare.flowDiagnostics') }}
      pre {{ JSON.stringify(data.data.diagnostics,null,2) }}
      p {{ data.data.method?.id ?? index.method?.id }}
</template>
