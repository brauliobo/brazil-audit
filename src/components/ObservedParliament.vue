<script setup vapor>
import { computed } from 'vue'
import { route,setParam } from '../router'
import { ELECTIONS,selectedOffice } from '../model'
import { stateTitle } from '../labels'
import { t } from '../i18n'
import { int } from '../format'
import { ensureRoster,rosterSql,placesSql } from '../election-results'
import { useAsync } from '../use'
import { objects } from '../db'
import Panel from './Panel.vue'
import Field from './Field.vue'
import DataTable from './DataTable.vue'
import Notice from './Notice.vue'
const key=computed(()=>route.value.election)
const cfg=computed(()=>ELECTIONS[key.value])
const office=computed(()=>selectedOffice(key.value,route.value.params.get('office')))
const state=computed(()=>route.value.params.get('state')??office.value.capabilities.states[0]??'')
const city=computed(()=>route.value.params.get('city_code')??'')
const scope=computed(()=>({state:state.value,city_code:city.value}))
const request=computed(()=>rosterSql(key.value,office.value.key,scope.value))
const data=useAsync(()=>[key.value,office.value.key,state.value,city.value],async([k,o],q)=>{
  await ensureRoster(k,o,scope.value)
  const rows=objects(await q(request.value.sql,request.value.params))
  const places=placesSql(k,o,{state:state.value})
  return {rows,places:objects(await q(places.sql,places.params))}
})
const page=computed(()=>Number(route.value.params.get('roster_page')??0))
const known=computed(()=>(data.data?.rows??[]).some(r=>r.is_elected!=null))
const elected=computed(()=>(data.data?.rows??[]).filter(r=>r.is_elected===true))
const parties=computed(()=>[...Map.groupBy(elected.value,r=>r.party_label)].map(([party,rows])=>({party,records:rows.length})).toSorted((a,b)=>b.records-a.records))
const columns=computed(()=>[
 {key:'name',label:t('analysis.candidate')},{key:'city_name',label:t('common.city')},{key:'party_label',label:t('common.party')},
 {key:'status',label:t('candidateRoster.outcome')},{key:'candidacy_status',label:t('candidateRoster.registrationStatus')},
 ...['gender','race','education','occupation','age_band'].map(key=>({key,label:t(`candidateRoster.${key}`)})),
])
const pick=(name,event)=>{setParam(name,event.target.value);if(name==='state'||name==='office')setParam('city_code',null)}
</script>
<template lang="pug">
h1 {{ t('candidateRoster.title') }}
p.muted {{ t('candidateRoster.observedNote') }}
.cluster
  Field(:label="t('common.office')")
    select(:value="office.key" @change="pick('office',$event)")
      option(v-for="o in cfg.officeDefinitions" :key="o.key" :value="o.key" :selected="o.key===office.key") {{ o.name }}
  Field(:label="t('common.state')")
    select(:value="state" @change="pick('state',$event)")
      option(v-for="s in office.capabilities.states" :key="s" :value="s" :selected="s===state") {{ stateTitle(s) }}
  Field(v-if="office.constituencyGrain==='municipality'" :label="t('common.city')")
    select(:value="city" @change="pick('city_code',$event)")
      option(value="" :selected="!city") {{ t('candidateRoster.allCities') }}
      option(v-for="p in data.data?.places??[]" :key="p.city_code" :value="p.city_code" :selected="p.city_code===city") {{ p.city_name }} · {{ p.city_code }}
Notice(v-if="office.constituencyGrain==='municipality'&&!city") {{ t('candidateRoster.separateBodies') }}
.grid-auto
  Panel(:title="t('candidateRoster.observedElected')" :state="data" :election="key")
    p {{ t('candidateRoster.records', {n:known?int(elected.length):'–'}) }}
    DataTable(:rows="parties" :columns="[{key:'party',label:t('common.party')},{key:'records',label:t('candidateRoster.observedElected'),num:true,fmt:int}]")
  Panel(:title="t('candidateRoster.registrations')" :state="data" :election="key" wide)
    DataTable(:rows="(data.data?.rows??[]).slice(page*100,(page+1)*100)" :columns="columns" :page="page" :size="100" :total="data.data?.rows.length??0" @page="setParam('roster_page',String($event))")
    p.muted {{ t('candidateRoster.unknownNote') }}
</template>
