<script setup vapor>
import { computed, ref, watch } from 'vue'
import { route, href, go, setParam } from '../router'
import { currentStateGeometry, territorialGrain, contextState } from '../election-registry'
import { ELECTIONS, selectedOffice } from '../model'
import { electionLabel } from '../labels'
import { ensureElection, unitsSql } from '../election-results'
import { objects } from '../db'
import { loadGeo } from '../geo'
import { useAsync } from '../use'
import { int, pct } from '../format'
import { partyColor } from '../colors'
import { t } from '../i18n'
import Panel from '../components/Panel.vue'
import Field from '../components/Field.vue'
import Notice from '../components/Notice.vue'
import DataTable from '../components/DataTable.vue'
import GeoMap from '../components/GeoMap.vue'
import ElectionContext from '../components/ElectionContext.vue'
import CollectorMaps from '../components/collector/Maps.vue'
const key = computed(() => route.value.election)
const expanded = ref(false)
const cfg = computed(() => ELECTIONS[key.value])
const office = computed(() => selectedOffice(key.value,route.value.params.get('office')))
const state = computed(() => contextState(office.value,route.value.params.get('state')))
const availableStates = computed(() => office.value.capabilities.states.filter((s) => s && s !== 'br'))
const page = ref(0)
watch(() => [key.value,office.value.key,state.value], () => { page.value=0 })
const metric = computed(() => route.value.params.get('metric') ?? 'winner')
const data = useAsync(() => [key.value,office.value.key,state.value],async ([k,o,s],q) => {
  await ensureElection(k,o,{state:s})
  const grain = territorialGrain(office.value)
  const query = unitsSql(k,o,grain ?? 'municipality',{state:s})
  const rows = objects(await q(query.sql,query.params))
  const leaders = rows.filter((r) => Number(r.rn) === 1)
  const map = grain === 'state' && ELECTIONS[k].year >= 1990 ? await loadGeo('uf') : null
  const geometry = currentStateGeometry(k,leaders.filter((r) => r.state !== 'zz').map((r) => r.state),map?.items.map(([id]) => String(id)) ?? [])
  return {rows,leaders,grain,states:[...new Set(rows.map((r) => r.state))].sort(),geometry,map:geometry.available ? map : null}
})
const metricValue = (row,opponent) => {
  if (metric.value === 'winner') return 1
  if (metric.value === 'blank') return row.blank != null && row.nul != null && row.ballots > 0 ? (row.blank+row.nul)/row.ballots : null
  if (!(row.candidate_total > 0)) return null
  return metric.value === 'margin' ? (row.votes-(opponent?.votes ?? 0))/row.candidate_total : row.votes/row.candidate_total
}
const fills = computed(() => Object.fromEntries((data.data?.leaders ?? []).filter((r) => r.state !== 'zz').flatMap((r) => {
  const opponent = data.data.rows.find((x) => x.state === r.state && Number(x.rn) === 2)
  const value = metricValue(r,opponent)
  return value == null || !Number.isFinite(value) ? [] : [[r.state,[metric.value === 'blank' ? 'var(--primary)' : partyColor(r.party),Math.min(1,0.25+value*0.75)]]]
})))
const tip = (id) => {
  const r = data.data.leaders.find((r)=>r.state === id)
  return r ? `${id.toUpperCase()}\n${r.cname ?? r.number ?? r.cand}: ${int(r.votes)} (${pct(r.candidate_total > 0 ? r.votes/r.candidate_total : null)})` : id
}
const open = (state) => href(key.value,'drill',[state],{office:office.value.key})
const columns = computed(() => [
  {key:'name',label:t('turnout.place'),href:(r)=>href(key.value,'drill',[r.state,...(r.city_code ? [r.city_code] : [])],{office:office.value.key}),fmt:(_,r)=>[r.state?.toUpperCase(),r.city_name,r.city_code].filter(Boolean).join(' · ')},
  {key:'cname',label:t('electionData.leader')},
  {key:'votes',label:t('electionData.votes'),num:true,fmt:int},
  {key:'candidate_total',label:t('electionData.candidateTotal'),num:true,fmt:int},
  {key:'blank',label:t('electionData.fields.blank'),num:true,fmt:int},
  {key:'nul',label:t('electionData.fields.nul'),num:true,fmt:int},
])
</script>
<template lang="pug">
h1 {{ t('nav.maps') }} · {{ electionLabel(key) }}
ElectionContext(:states="availableStates" :state="state")
Panel(:title="office.name" :state="data" :election="key" wide)
  Field(v-if="data.data.map" :label="t('maps.show')")
    select(:value="metric" @change="setParam('metric',$event.target.value)")
      option(v-for="m in ['winner','share','margin','blank']" :key="m" :value="m" :selected="m === metric") {{ m === 'share' ? t('electionData.leadingShare') : t(`maps.metric.${m}`) }}
  p.muted(v-if="data.data.map && data.data.geometry.unmappedCodes.length") {{ t('electionData.unmappedStates', {codes:data.data.geometry.unmappedCodes.map(s => s.toUpperCase()).join(', ')}) }}
  p.muted(v-if="data.data.map") {{ t('electionData.referenceGeometry') }}
  GeoMap(v-if="data.data.map" :map="data.data.map" :fills="fills" :tip="tip" :label="office.name" keyboard @pick="(id) => go(open(id))")
  Notice(v-else) {{ t('electionData.mapUnavailable') }}
  p.muted(v-if="data.data.rows[0]?.count_meaning") {{ t(`electionData.meanings.${data.data.rows[0].count_meaning}`) }}
  DataTable(:columns="columns" :rows="data.data.leaders.slice(page*30,(page+1)*30)" :page="page" :size="30" :total="data.data.leaders.length" @page="page = $event")
details(v-if="cfg.legacyKey" @toggle="expanded = $event.target.open")
  summary {{ t('electionData.mapDetails') }}
  CollectorMaps(v-if="expanded")
</template>
