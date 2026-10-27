<script setup vapor>
import { computed, ref } from 'vue'
import { route, href } from '../router'
import { selectedOffice } from '../model'
import { ensureElection, totalsSql, candidatesSql, unitsSql, provenanceSql } from '../election-results'
import { useAsync } from '../use'
import { objects } from '../db'
import { int, pct } from '../format'
import { t } from '../i18n'
import { grainLabel } from '../labels'
import ElectionContext from './ElectionContext.vue'
import OfficialTurnout from './OfficialTurnout.vue'
import Panel from './Panel.vue'
import DataTable from './DataTable.vue'
import BarList from './BarList.vue'
import Notice from './Notice.vue'
const props = defineProps({ drill: Boolean })
const candidateOpen = ref(false)
const candidatePage = ref(0)
const key = computed(() => route.value.election)
const office = computed(() => selectedOffice(key.value,route.value.params.get('office')))
const scope = computed(() => props.drill ? Object.fromEntries(['state','city_code','zone','section'].map((k,i) => [k,route.value.args[i]]).filter(([,v]) => v)) : {state:route.value.params.get('state') || undefined})
const base = useAsync(() => [key.value,office.value.key,scope.value], async ([k,o,s]) => { await ensureElection(k,o,{...s,grain:props.drill ? ['state','municipality','zone','section'][Math.min(route.value.args.length,3)] : 'state'}); return true })
const data = useAsync(() => [key.value,office.value.key,scope.value,base.loading],async ([k,o,s],q) => {
  if(base.loading) return null
  const run = async (request) => objects(await q(request.sql,request.params))
  const wanted = ['state','municipality','zone','section'][Math.min(route.value.args.length,3)]
  const ranks = ['national','state','municipality','zone','section']
  const available = office.value.capabilities.grains.some((g) => ranks.indexOf(g) >= ranks.indexOf(wanted))
  const [totals,candidates,units,sources] = await Promise.all([run(totalsSql(k,o,s)),run(candidatesSql(k,o,s)),props.drill && !available ? [] : run(unitsSql(k,o,props.drill ? wanted : 'state',props.drill ? s : {})),run(provenanceSql(k,o,s))])
  return {total:totals[0],candidates,units,sources,states:[...new Set(units.map((r) => r.state))].sort()}
})
const fields = ['sections','nominal','valid','blank','nul','ballots']
const items = computed(() => data.data?.candidates.slice(0,25).map((r) => ({ label:[r.short_name || r.name || r.number,r.party,office.value.key === 'president' ? null : r.state?.toUpperCase()].filter(Boolean).join(' · '),value:r.votes,text:`${int(r.votes)} · ${pct(r.total ? r.votes/r.total : null)}` })) ?? [])
const candidatesColumns = computed(() => [
  {key:'name',label:t('electionData.candidate')},
  {key:'state',label:t('common.state')},
  {key:'number',label:t('electionData.number')},
  {key:'party',label:t('electionData.party')},
  {key:'votes',label:t('electionData.votes'),num:true,fmt:int},
])
const units = computed(() => data.data?.units.filter((r) => r.rn === 1 || r.rn == null) ?? [])
const unitColumns = computed(() => [
  {key:'name',label:t('turnout.place'),fmt:(_,r)=>[r.state?.toUpperCase(),r.city_code,r.zone,r.section].filter(Boolean).join(' · '),href:(r)=>href(key.value,'drill',[r.state,r.city_code,r.zone,r.section].filter(Boolean),{office:office.value.key})},
  {key:'cname',label:t('electionData.leader')},
  {key:'votes',label:t('electionData.votes'),num:true,fmt:int},
  {key:'sections',label:t('electionData.sections'),num:true,fmt:int},
])
</script>
<template lang="pug">
ElectionContext(v-if="data.data && !drill" :states="data.data.states")
Panel(:title="office.name" :state="data" :election="key" wide)
  template(v-if="data.data.total")
    p {{ t('electionData.grain', {grain: grainLabel(data.data.total.grain), n: int(data.data.total.units)}) }}
    dl.election-totals
      template(v-for="field in fields" :key="field")
        div
          dt {{ t(`electionData.fields.${field}`) }}
          dd {{ int(data.data.total[field]) }}
    BarList(v-if="items.length" :items="items")
    details(v-if="data.data.candidates.length" @toggle="candidateOpen = $event.target.open")
      summary {{ t('electionData.allCandidates', {n:data.data.candidates.length}) }}
      DataTable(v-if="candidateOpen" :columns="candidatesColumns" :rows="data.data.candidates.slice(candidatePage*25,(candidatePage+1)*25)" :page="candidatePage" :size="25" :total="data.data.candidates.length" @page="candidatePage = $event")
    Notice(v-else) {{ t('electionData.noCandidates') }}
    details(v-if="units.length")
      summary {{ t('electionData.byState') }}
      DataTable(:columns="unitColumns" :rows="units")
    details(v-if="data.data.sources.length")
      summary {{ t('electionData.source') }}
      p(v-for="source in data.data.sources" :key="source.source_url")
        a(:href="source.source_url" target="_blank" rel="noopener") {{ source.source_url }}
        code(v-if="source.source_sha256") {{ source.source_sha256 }}
  Notice(v-else) {{ t('electionData.noUnits') }}
OfficialTurnout(:year="key" :scope="scope" :office-key="office.key" summary)
</template>
<style scoped>
.election-totals { display: flex; flex-wrap: wrap; gap: var(--space-4); }
.election-totals div { min-width: var(--size-control); }
a, code { overflow-wrap: anywhere; }
.election-totals dd { margin: 0; font-weight: 700; }
</style>
