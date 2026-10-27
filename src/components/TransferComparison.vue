<script setup vapor>
import {computed,ref} from 'vue'
import {route,setParam,href} from '../router'
import {store,tables,parts,ensure} from '../data'
import {objects} from '../db'
import {useAsync} from '../use'
import {int} from '../format'
import {t} from '../i18n'
import {TRANSFER_CATEGORIES} from '../transfer-contract'
import {transferIndex} from '../transfers'
import {transferMetadataSql,transferRoundsSql,transferObservedSql,transferUnitsSql,transferBoundsSql} from '../transfer-sql'
import Field from './Field.vue'
import Panel from './Panel.vue'
import DataTable from './DataTable.vue'
import TransferModels from './TransferModels.vue'
const available=computed(()=>!!tables().state_rounds && !!tables().state_round_counts && Array.isArray(store.manifest.stateFacts?.pairedYears))
const years=computed(()=>available.value?[...store.manifest.stateFacts.pairedYears].sort((a,b)=>b-a):[])
const year=computed(()=>{const n=Number(route.value.params.get('flow_year'));return years.value.includes(n)?n:years.value[0]})
const metadata=useAsync(()=>[available.value,year.value],async([ready,y],q)=>{
  if(!ready||!y)return []
  await ensure('state_rounds',parts('state_rounds').filter(p=>p.startsWith(`${y}/`)))
  return objects(await q(transferMetadataSql,[y]))
})
const offices=computed(()=>[...new Set((metadata.data??[]).filter(r=>r.year===year.value).map(r=>r.office))].sort((a,b)=>a-b))
const office=computed(()=>{const n=Number(route.value.params.get('flow_office'));return offices.value.includes(n)?n:offices.value[0]})
const states=computed(()=>[...new Set((metadata.data??[]).filter(r=>r.year===year.value&&r.office===office.value).map(r=>r.state))].sort())
const state=computed(()=>{
  const wanted=route.value.params.get('flow_state')??route.value.params.get('state')
  return (office.value===1&&wanted==='br')||states.value.includes(wanted)?wanted:states.value.includes('sp')?'sp':states.value[0]
})
const contests=computed(()=>{
  const rows=(metadata.data??[]).filter(r=>r.year===year.value&&r.office===office.value&&(state.value==='br'||r.state===state.value))
  return [...new Map(rows.map(r=>[r.contest_id,r])).values()]
})
const selected=computed(()=>contests.value.find(r=>r.contest_id===route.value.params.get('contest'))??contests.value[0])
const label=(id,name)=>TRANSFER_CATEGORIES.includes(id)?t(`compare.flowCategories.${id}`):name??id
const data=useAsync(()=>[selected.value?.contest_id,year.value,office.value,state.value,selected.value?.city],async([id,y,o,uf,city],q)=>{
  if(!id)return null
  await ensure('state_round_counts',parts('state_round_counts').filter(p=>p.startsWith(`${y}/`)))
  const params=[id,uf,o,city]
  const rounds=objects(await q(transferRoundsSql,params))
  const observed=objects(await q(transferObservedSql,params))
  const units=objects(await q(transferUnitsSql,params))
  const cells=objects(await q(transferBoundsSql,params))
  return {rounds,observed,units,cells}
})
const axes=computed(()=>{
  const from=new Map(),to=new Map()
  for(const c of data.data?.cells??[]){from.set(c.from_id,{id:c.from_id,label:label(c.from_id,c.from_label),total:c.from_total});to.set(c.to_id,{id:c.to_id,label:label(c.to_id,c.to_label),total:c.to_total})}
  return {from:[...from.values()],to:[...to.values()]}
})
const matrixColumns=computed(()=>[{key:'origin',label:t('compare.flowFrom')},{key:'total',label:t('compare.flowOriginTotal'),num:true,fmt:int},...axes.value.to.map((r,i)=>({key:`target_${i}`,label:r.label}))])
const matrixRows=computed(()=>{
  const {from,to}=axes.value
  if(!from.length)return []
  const result=from.map(r=>({origin:r.label,total:r.total,...Object.fromEntries(to.map((c,i)=>{const cell=data.data.cells.find(x=>x.from_id===r.id&&x.to_id===c.id);return [`target_${i}`,`${int(cell.bound_low)} – ${int(cell.bound_high)}`]}))}))
  result.push({origin:t('compare.flowTargetTotal'),total:from.reduce((n,r)=>n+r.total,0),...Object.fromEntries(to.map((r,i)=>[`target_${i}`,int(r.total)]))})
  return result
})
const roundColumns=computed(()=>[
  {key:'state',label:t('common.state')},{key:'turn',label:t('election.round')},{key:'date',label:t('compare.historyDates')},
  ...['electorate','installed','present','absent','not_installed'].map(key=>({key,label:t(`compare.roundFields.${key}`),num:true,fmt:int})),
  {key:'source_url',label:t('compare.source'),href:r=>r.source_url,fmt:()=>t('history.source')},
])
const observedColumns=computed(()=>[{key:'state',label:t('common.state')},{key:'turn',label:t('election.round')},{key:'label',label:t('compare.observedCategory'),fmt:(_,r)=>label(r.category_id,r.label)},{key:'n',label:t('compare.observedCount'),num:true,fmt:int}])
const unitColumns=computed(()=>[{key:'state',label:t('common.state')},{key:'first_electorate',label:t('compare.firstElectorate'),num:true,fmt:int},{key:'second_electorate',label:t('compare.secondElectorate'),num:true,fmt:int},{key:'population',label:t('compare.technicalPopulation'),num:true,fmt:int},{key:'reason',label:t('compare.historyAvailability'),fmt:v=>v?t(`compare.unitReasons.${v}`):t('compare.completeMargins')}])
const coverage=computed(()=>{const units=data.data?.units??[],valid=units.filter(r=>r.valid);return {all:units.length,valid:valid.length,population:valid.length?valid.reduce((n,r)=>n+Number(r.population),0):null}})
const csv=computed(()=>!data.data?'':'data:text/csv;charset=utf-8,'+encodeURIComponent([
  ['contest','uf','office','from_id','to_id','from_total','to_total','bound_low','bound_high','scenario'],
  ...data.data.cells.map(r=>[selected.value.contest_id,state.value,office.value,r.from_id,r.to_id,r.from_total,r.to_total,r.bound_low,r.bound_high,'minimum-registration-balance']),
].map(row=>row.map(v=>`"${String(v??'').replaceAll('"','""')}"`).join(',')).join('\n')))
const showModels=ref(false)
</script>
<template lang="pug">
p.muted {{ t('compare.liveIntro') }}
p(v-if="!available") {{ t('compare.livePreparing') }}
Panel(v-if="available && !selected" :title="t('compare.liveTitle')" :state="metadata" :election="route.election" wide)
  p {{ t('compare.liveNoBounds') }}
.cluster(v-if="years.length")
  Field(:label="t('election.year')")
    select(:value="year" @change="setParam('flow_year',$event.target.value)")
      option(v-for="y in years" :key="y" :value="y") {{ y }}
  Field(:label="t('common.office')")
    select(:value="office" @change="setParam('flow_office',$event.target.value)")
      option(v-for="o in offices" :key="o" :value="o") {{ t(`compare.flowOffices.${o}`) }}
  Field(:label="t('common.state')")
    select(:value="state" @change="setParam('flow_state',$event.target.value)")
      option(v-if="office === 1" value="br") {{ t('compare.brazilUfSum') }}
      option(v-for="uf in states" :key="uf" :value="uf") {{ uf.toUpperCase() }}
  Field(v-if="contests.length > 1" :label="t('compare.election')")
    select(:value="selected?.contest_id" @change="setParam('contest',$event.target.value)")
      option(v-for="c in contests" :key="c.contest_id" :value="c.contest_id") {{ c.description }} · {{ c.city || c.state }} · {{ c.first_date }} – {{ c.last_date }}
Panel(v-if="selected" :title="t('compare.liveTitle')" :state="data" :election="route.election" wide)
  p.muted {{ selected.description }} · {{ selected.first_date }} – {{ selected.last_date }}
  p {{ t('compare.liveCoverage',{valid:int(coverage.valid),all:int(coverage.all),population:int(coverage.population)}) }}
  p.muted {{ t('compare.liveScenario') }}
  p.muted {{ t('compare.liveBoundsNote') }}
  DataTable(v-if="matrixRows.length" :columns="matrixColumns" :rows="matrixRows")
  p(v-else) {{ t('compare.liveNoBounds') }}
  a.btn.btn--ghost(v-if="matrixRows.length" :href="csv" download="territorial-bounds.csv") {{ t('compare.flowDownloadCSV') }}
  details(open)
    summary {{ t('compare.roundTotals') }}
    DataTable(:columns="roundColumns" :rows="data.data.rounds")
  details
    summary {{ t('compare.observedCategories') }}
    DataTable(:columns="observedColumns" :rows="data.data.observed")
  details
    summary {{ t('compare.populationChecks') }}
    DataTable(:columns="unitColumns" :rows="data.data.units")
  a.btn.btn--ghost(:href="href(route.election,'sql')") {{ t('nav.sql') }}
details(v-if="transferIndex?.models?.length" @toggle="showModels=$event.target.open")
  summary {{ t('compare.modelsTitle') }}
  TransferModels(v-if="showModels")
</template>
