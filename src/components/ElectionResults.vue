<script setup vapor>
import { computed, ref, watch } from 'vue'
import { route, href } from '../router'
import { territorialGrain, contextState } from '../election-registry'
import { selectedOffice } from '../model'
import { ensureElection, totalsSql, candidatesSql, unitsSql, provenanceSql, placesSql } from '../election-results'
import { useAsync } from '../use'
import { objects } from '../db'
import { int, pct } from '../format'
import { t } from '../i18n'
import { grainLabel } from '../labels'
import SourceNominations from './SourceNominations.vue'
import ElectionContext from './ElectionContext.vue'
import OfficialTurnout from './OfficialTurnout.vue'
import Panel from './Panel.vue'
import DataTable from './DataTable.vue'
import BarList from './BarList.vue'
import Notice from './Notice.vue'
const props = defineProps({ drill: Boolean })
const candidateOpen = ref(false)
const candidatePage = ref(0)
const unitOpen = ref(false)
const unitPage = ref(0)
const key = computed(() => route.value.election)
const office = computed(() => selectedOffice(key.value,route.value.params.get('office')))
const activeState = computed(() => contextState(office.value,route.value.params.get('state')))
const scope = computed(() => props.drill ? Object.fromEntries(['state','city_code','zone','section'].map((k,i) => [k,route.value.args[i]]).filter(([,v]) => v)) : {state:activeState.value || undefined,city_code:route.value.params.get('city') || undefined})
watch(() => [key.value,office.value.key,scope.value], () => { candidatePage.value=0; unitPage.value=0 })
const base = useAsync(() => [key.value,office.value.key,scope.value], async ([k,o,s]) => { await ensureElection(k,o,{...s,grain:props.drill ? ['state','municipality','zone','section'][Math.min(route.value.args.length,3)] : 'state'}); return true })
const data = useAsync(() => [key.value,office.value.key,scope.value,base.loading,candidatePage.value],async ([k,o,s,,page],q) => {
  if(base.loading) return null
  const run = async (request) => objects(await q(request.sql,request.params))
  const wanted = props.drill ? ['state','municipality','zone','section'][Math.min(route.value.args.length,3)] : territorialGrain(office.value)
  const ranks = ['national','state','municipality','zone','section']
  const available = office.value.capabilities.grains.some((g) => ranks.indexOf(g) >= ranks.indexOf(wanted))
  const [totals,candidates,units,sources,places,pagedCandidates] = await Promise.all([run(totalsSql(k,o,s)),run(candidatesSql(k,o,s,{limit:25,offset:0})),!wanted || props.drill && !available ? [] : run(unitsSql(k,o,wanted,s)),run(provenanceSql(k,o,s)),run(placesSql(k,o,{state:s.state})),page ? run(candidatesSql(k,o,s,{limit:25,offset:page*25})) : []])
  return {total:totals[0],candidates,pagedCandidates:page ? pagedCandidates : candidates,totalCandidates:candidates.length ? Number(candidates[0].total_rows) : 0,units,sources,places,states:[...new Set(units.map((r) => r.state))].sort()}
})
const locality = computed(() => {
  const place=data.data?.places.find((r) => r.city_code === scope.value.city_code || r.city_name === scope.value.city_code)
  return [scope.value.state?.toUpperCase(),place?.city_name,place?.city_code ?? scope.value.city_code,scope.value.zone,scope.value.section].filter(Boolean).join(' · ')
})
const hasVoteCounts = computed(() => data.data?.candidates.some((row) => row.votes != null))
const fields = ['sections','nominal','valid','blank','nul','ballots']
const fieldLabel = (field) => field === 'nominal' && data.data.total.nominal_kind ? t(`electionData.meanings.${data.data.total.nominal_kind}`) : t(`electionData.fields.${field}`)
const items = computed(() => data.data?.candidates.filter((r) => r.votes != null).slice(0,25).map((r) => ({ label:[r.short_name || r.name || r.number,r.party_label,office.value.key === 'president' ? null : r.state?.toUpperCase(),r.city_name || r.city_code || (territorialGrain(office.value) === 'municipality' ? r.constituency : null)].filter(Boolean).join(' · '),value:r.votes,text:`${int(r.votes)} · ${pct(r.candidate_total ? r.votes/r.candidate_total : null)}` })) ?? [])
const candidatesColumns = computed(() => [
  {key:'name',label:t('electionData.candidate')},
  {key:'state',label:t('common.state')},
  {key:'constituency',label:t('electionData.constituency'),fmt:(_,r)=>r.city_name || r.city_code || r.constituency},
  {key:'number',label:t('electionData.number')},
  {key:'party_label',label:t('electionData.party')},
  {key:'status',label:t('electionData.registrationStatus')},
  {key:'votes',label:t('electionData.votes'),num:true,fmt:int},
])
const units = computed(() => data.data?.units.filter((r) => r.rn === 1 || r.rn == null) ?? [])
const unitColumns = computed(() => [
  {key:'name',label:t('turnout.place'),fmt:(_,r)=>[r.state?.toUpperCase(),r.city_name,r.city_code,r.zone,r.section].filter(Boolean).join(' · '),href:(r)=>href(key.value,'drill',[r.state,r.city_code,r.zone,r.section].filter(Boolean),{office:office.value.key})},
  {key:'cname',label:t('electionData.leader')},
  {key:'votes',label:t('electionData.votes'),num:true,fmt:int},
  {key:'sections',label:t('electionData.sections'),num:true,fmt:int},
])
</script>
<template lang="pug">
ElectionContext(v-if="data.data && !drill" :states="office.capabilities.states.filter(s => s && s !== 'br')" :state="activeState" :cities="activeState ? data.data.places : []")
p(v-if="drill && locality") {{ locality }}
Panel(:title="office.name" :state="data" :election="key" wide)
  template(v-if="data.data.total?.units || data.data.candidates.length")
    p(v-if="data.data.total?.units") {{ t('electionData.grain', {grain: grainLabel(data.data.total.grain), n: int(data.data.total.units)}) }}
    p(v-if="!data.data.total?.units") {{ t(hasVoteCounts ? 'electionData.noOfficialTotals' : 'electionData.registrationOnly', {n:data.data.totalCandidates}) }}
    dl.election-totals(v-if="data.data.total?.units")
      template(v-for="field in fields" :key="field")
        div
          dt {{ fieldLabel(field) }}
          dd {{ int(data.data.total[field]) }}
    p.muted(v-if="items.length") {{ t('electionData.candidateShareNote') }}
    BarList(v-if="items.length" :items="items")
    details(v-if="data.data.candidates.length" :open="!data.data.total?.units && !hasVoteCounts" @toggle="candidateOpen = $event.target.open")
      summary {{ t('electionData.allCandidates', {n:data.data.totalCandidates}) }}
      DataTable(v-if="candidateOpen || (!data.data.total?.units && !hasVoteCounts)" :columns="candidatesColumns" :rows="data.data.pagedCandidates" :page="candidatePage" :size="25" :total="data.data.totalCandidates" @page="candidatePage = $event")
    Notice(v-else) {{ t('electionData.noCandidates') }}
    details(v-if="units.length" @toggle="unitOpen = $event.target.open")
      summary {{ t('electionData.byTerritory') }}
      DataTable(v-if="unitOpen" :columns="unitColumns" :rows="units.slice(unitPage*30,(unitPage+1)*30)" :page="unitPage" :size="30" :total="units.length" @page="unitPage = $event")
    details(v-if="data.data.sources.length")
      summary {{ t('electionData.source') }}
      p(v-for="source in data.data.sources" :key="source.source_url")
        a(:href="source.source_url" target="_blank" rel="noopener") {{ source.source_url }}
        code(v-if="source.source_sha256") {{ source.source_sha256 }}
  Notice(v-else) {{ t('electionData.noUnits') }}
OfficialTurnout(:year="key" :scope="scope" :office-key="office.key" summary)
SourceNominations(:election="key" :office="office.key" :scope="scope")
</template>
<style scoped>
.election-totals { display: flex; flex-wrap: wrap; gap: var(--space-4); }
.election-totals div { min-width: var(--size-control); }
a, code { overflow-wrap: anywhere; }
.election-totals dd { margin: 0; font-weight: 700; }
</style>
