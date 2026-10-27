<script setup vapor>
import { computed,reactive,watch,ref } from 'vue'
import { tables } from '../data'
import { useAsync } from '../use'
import { objects } from '../db'
import { int } from '../format'
import { t } from '../i18n'
import { NOMINATION_TABLES,NOMINATION_COLUMNS,NOMINATION_NAMES,nominationSelection,nominationPartIds,nominationFactsQuery,ensureNominations } from '../election-nominations'
import Panel from './Panel.vue'
import DataTable from './DataTable.vue'
import Notice from './Notice.vue'
const props=defineProps({election:String,office:String,scope:Object})
const selection=computed(()=>nominationSelection(props.election,props.office,props.scope))
const available=computed(()=>NOMINATION_TABLES.filter(table=>tables()[table]&&nominationPartIds(table,selection.value).length))
const pages=reactive({}),opened=ref(false)
watch(()=>[props.election,props.office,props.scope],()=>{for(const table of NOMINATION_TABLES)pages[table]=0})
const data=useAsync(()=>[props.election,props.office,props.scope,available.value,opened.value],async(_,q)=>{
 if(!opened.value)return {}
 const result={}
 for(const table of available.value){await ensureNominations(table,selection.value);const request=nominationFactsQuery(table,selection.value);result[table]=objects(await q(request.sql,request.params))}
 return result
})
const names=Object.fromEntries(NOMINATION_TABLES.map((table,i)=>[table,NOMINATION_NAMES[i]]))
const common=NOMINATION_COLUMNS.common,fields=NOMINATION_COLUMNS
const columns=table=>[...common,...fields[table], 'binding_kind'].filter(key=>['source_year','office_name','state','binding_kind',...fields[table].filter(f=>f==='seats')].includes(key)||(data.data?.[table]??[]).some(r=>r[key]!=null)).map(key=>({key,label:t(`sourceNominations.fields.${key}`),...(key==='seats'?{num:true,fmt:int}:key==='binding_kind'?{fmt:v=>v==='source-context'?t('sourceNominations.contextBinding'):v==='exact-event'?t('sourceNominations.exactBinding'):v}:['constituency_grain','office_constituency_grain'].includes(key)?{fmt:v=>['national','state','municipality','zone','section'].includes(v)?t(`electionAnalysis.grains.${v}`):v}:{})}))
const provenance=computed(()=>[...new Map(Object.values(data.data??{}).flat().map(r=>[r.source_url,{url:r.source_url,hash:r.source_sha256}])).values()])
</script>
<template lang="pug">
details.source-nominations(v-if="available.length" @toggle="opened=$event.currentTarget.open")
  summary {{ t('sourceNominations.title') }}
  Panel(v-if="opened" :title="t('sourceNominations.title')" :state="data" :election="election" wide)
    Notice {{ t('sourceNominations.context') }}
    p.muted {{ t('sourceNominations.noInference') }}
    template(v-for="table in available" :key="table")
      h3 {{ t(`sourceNominations.tables.${names[table]}`) }}
      DataTable(:columns="columns(table)" :rows="(data.data?.[table]??[]).slice((pages[table]??0)*100,((pages[table]??0)+1)*100)" :page="pages[table]??0" :size="100" :total="data.data?.[table]?.length??0" @page="pages[table]=$event")
      p.muted(v-if="!data.loading&&!data.data?.[table]?.length") {{ t('sourceNominations.noRecords') }}
    details
      summary {{ t('compare.source') }}
      p(v-for="source in provenance" :key="source.url")
        a(:href="source.url") {{ source.url }}
        br
        code {{ source.hash }}
</template>
<style scoped>
.source-nominations { margin-top: var(--space-4); }
.source-nominations a,.source-nominations code { overflow-wrap: anywhere; }
</style>
