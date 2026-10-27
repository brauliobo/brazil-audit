<script setup vapor>
import { computed } from 'vue'
import { ELECTION_LIST,ELECTIONS,selectedOffice } from '../model'
import { route,setParam } from '../router'
import { electionLabel,stateTitle } from '../labels'
import { t } from '../i18n'
import { int,pct,signed } from '../format'
import { ensureElection,totalsSql,candidatesSql } from '../election-results'
import { ELECTION_COMPARISON_METRICS,NATIVE_METRICS,needsCandidate,nativeComparisonQuery,candidateComparisonQuery,comparisonValue,comparisonChanges } from '../election-comparison'
import { useAsync } from '../use'
import { objects } from '../db'
import Field from './Field.vue'
import Panel from './Panel.vue'
import DataTable from './DataTable.vue'
import Notice from './Notice.vue'
const metrics=ELECTION_COMPARISON_METRICS.filter(m=>NATIVE_METRICS[m.id]||m.source==='competition')
const selected=computed(()=>metrics.some(m=>m.id===route.value.params.get('canonical_metric'))?route.value.params.get('canonical_metric'):'abstention_rate')
const metric=computed(()=>metrics.find(m=>m.id===selected.value))
const definitions=[...new Map(ELECTION_LIST.flatMap(e=>e.officeDefinitions).map(o=>[o.key,o])).values()]
const office=computed(()=>definitions.find(o=>o.key===route.value.params.get('canonical_office'))??selectedOffice(route.value.election))
const uf=computed(()=>route.value.params.get('canonical_state')??'')
const city=computed(()=>route.value.params.get('canonical_city')??'')
const turn=computed(()=>route.value.params.get('canonical_turn')??'')
const includeSupplementary=computed(()=>route.value.params.get('supplementary')==='1')
const states=computed(()=>[...new Set(ELECTION_LIST.flatMap(e=>e.officeDefinitions.filter(o=>o.key===office.value.key).flatMap(o=>o.capabilities.states)))].sort())
const elections=computed(()=>ELECTION_LIST.filter(e=>e.officeDefinitions.some(o=>o.key===office.value.key)&&(!turn.value||String(e.turn)===turn.value)&&(includeSupplementary.value||e.sourceSession.family!=='supplementary')))
const scoped=computed(()=>metric.value.source!=='competition'||office.value.constituencyGrain==='national'||(uf.value&&(office.value.constituencyGrain!=='municipality'||city.value)))
const scope=computed(()=>({state:uf.value,city_code:city.value}))
const targetsKey=computed(()=>elections.value.map(e=>route.value.params.get(`candidate_${e.key}`)??'').join('|'))
const options=useAsync(()=>[office.value.key,uf.value,city.value,turn.value,includeSupplementary.value,selected.value],async(_,q)=>{
 if(!needsCandidate(selected.value)||!scoped.value)return {}
 const out={}
 for(const e of elections.value){await ensureElection(e.key,office.value.key,scope.value);const r=candidatesSql(e.key,office.value.key,scope.value);out[e.key]=objects(await q(r.sql,r.params)).filter(c=>c.votes!=null)}
 return out
})
const data=useAsync(()=>[office.value.key,selected.value,uf.value,city.value,turn.value,includeSupplementary.value,targetsKey.value],async(_,q)=>{
 if(!scoped.value)return {rows:[]}
 const rows=[]
 for(const e of elections.value){
  await ensureElection(e.key,office.value.key,scope.value)
  const definition=e.officeDefinitions.find(o=>o.key===office.value.key)
  const request=NATIVE_METRICS[selected.value]?nativeComparisonQuery(selected.value,totalsSql(e.key,office.value.key,scope.value)):candidateComparisonQuery(selected.value,candidatesSql(e.key,office.value.key,scope.value),route.value.params.get(`candidate_${e.key}`)??'')
  const r=objects(await q(request.sql,request.params))[0]
  const value=comparisonValue(metric.value,r)
  rows.push({...r,key:e.key,label:electionLabel(e.key),date:e.date,value,status:value==null?t('compare.unavailable'):r.count_meaning,
    comparability:[office.value.key,uf.value,city.value,selected.value,r.count_meaning,definition.constituencyGrain].join('|')})
 }
 return {rows:comparisonChanges(rows)}
})
const show=v=>v==null?'–':metric.value.rate?pct(v,2):metric.value.decimal?Number(v).toFixed(4):int(v)
const columns=computed(()=>[
 {key:'label',label:t('compare.election')},{key:'date',label:t('canonicalComparison.date')},
 {key:'value',label:t('compare.value'),num:true,fmt:show},{key:'change',label:t('compare.change'),num:true,fmt:v=>v==null?'–':metric.value.rate?`${signed(v*100,2)} ${t('compare.pp')}`:signed(v)},
 {key:'numerator',label:t('compare.numerator'),num:true,fmt:int},{key:'denominator',label:t('compare.denominator'),num:true,fmt:int},
 {key:'target',label:t('compare.target')},{key:'status',label:t('compare.source')},
])
const pick=(name,event)=>setParam(name,event.target.value)
</script>
<template lang="pug">
p.muted {{ t('canonicalComparison.intro') }}
.cluster
  Field(:label="t('compare.indicator')")
    select(:value="selected" @change="pick('canonical_metric',$event)")
      option(v-for="m in metrics" :key="m.id" :value="m.id" :selected="m.id===selected") {{ t(`compare.metrics.${m.id}`) }}
  Field(:label="t('common.office')")
    select(:value="office.key" @change="pick('canonical_office',$event)")
      option(v-for="o in definitions" :key="o.key" :value="o.key" :selected="o.key===office.key") {{ o.name }}
  Field(:label="t('common.state')")
    select(:value="uf" @change="pick('canonical_state',$event)")
      option(value="" :selected="!uf") {{ t('common.brazil') }}
      option(v-for="s in states" :key="s" :value="s" :selected="s===uf") {{ stateTitle(s) }}
  Field(:label="t('canonicalComparison.cityCode')")
    input(:value="city" @change="pick('canonical_city',$event)" inputmode="numeric")
  Field(:label="t('canonicalComparison.turn')")
    select(:value="turn" @change="pick('canonical_turn',$event)")
      option(value="" :selected="!turn") {{ t('canonicalComparison.allTurns') }}
      option(value="1" :selected="turn==='1'") 1
      option(value="2" :selected="turn==='2'") 2
  label
    input(type="checkbox" :checked="includeSupplementary" @change="setParam('supplementary',$event.target.checked?'1':null)")
    | {{ t('canonicalComparison.supplementary') }}
Notice(v-if="!scoped") {{ t('canonicalComparison.jurisdiction') }}
Notice {{ t('canonicalComparison.definition') }}
.cluster(v-if="needsCandidate(selected)&&scoped")
  Field(v-for="e in elections" :key="e.key" :label="electionLabel(e.key)")
    select(:value="route.params.get(`candidate_${e.key}`)??''" @change="setParam(`candidate_${e.key}`,$event.target.value)")
      option(value="" :selected="!route.params.get(`candidate_${e.key}`)") {{ t('canonicalComparison.leading') }}
      option(v-for="c in options.data?.[e.key]??[]" :key="c.cand" :value="c.cand" :selected="route.params.get(`candidate_${e.key}`)===c.cand") {{ c.short_name??c.name }} · {{ c.party_label??'–' }}
Panel(:title="t('compare.title')" :state="data" :election="route.election" wide)
  DataTable(:columns="columns" :rows="data.data?.rows??[]")
</template>
