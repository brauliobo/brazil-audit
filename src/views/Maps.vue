<script setup vapor>
import { computed, ref } from 'vue'
import { route, href, go, setParam } from '../router'
import { ELECTIONS, UFS, selectedOffice } from '../model'
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
const metric = computed(() => route.value.params.get('metric') ?? 'winner')
const data = useAsync(() => [key.value,office.value.key],async ([k,o],q) => {
  await ensureElection(k,o)
  const query = unitsSql(k,o,'state')
  const rows = objects(await q(query.sql,query.params))
  const leaders = rows.filter((r) => Number(r.rn) === 1)
  const compatible = Boolean(ELECTIONS[k].legacyKey) && leaders.every((r) => UFS.includes(r.state))
  return {rows,leaders,states:[...new Set(rows.map((r) => r.state))].sort(),map:compatible ? await loadGeo('uf') : null}
})
const fills = computed(() => Object.fromEntries((data.data?.leaders ?? []).filter((r) => r.state !== 'zz').map((r) => {
  const opponent = data.data.rows.find((x) => x.state === r.state && Number(x.rn) === 2)
  const value = metric.value === 'margin' ? (r.votes-(opponent?.votes ?? 0))/r.valid : metric.value === 'blank' ? r.blank == null || r.nul == null || !r.ballots ? null : (r.blank+r.nul)/r.ballots : r.votes/r.valid
  if (value == null || !Number.isFinite(value)) return null
  return [r.state,[metric.value === 'blank' ? 'var(--primary)' : partyColor(r.party),Number.isFinite(value) ? Math.min(1,0.25+value*0.75) : 0]]
}).filter(Boolean)))
const tip = (id) => {
  const r = data.data.leaders.find((r)=>r.state === id)
  return r ? `${id.toUpperCase()}\n${r.cname ?? r.number ?? r.cand}: ${int(r.votes)} (${pct(r.valid ? r.votes/r.valid : null)})` : id
}
const open = (state) => href(key.value,'drill',[state],{office:office.value.key})
const columns = computed(() => [
  {key:'state',label:t('common.state'),href:(r)=>open(r.state),fmt:(v)=>v.toUpperCase()},
  {key:'cname',label:t('electionData.leader')},
  {key:'votes',label:t('electionData.votes'),num:true,fmt:int},
  {key:'valid',label:t('electionData.fields.nominal'),num:true,fmt:int},
  {key:'blank',label:t('electionData.fields.blank'),num:true,fmt:int},
  {key:'nul',label:t('electionData.fields.nul'),num:true,fmt:int},
])
</script>
<template lang="pug">
h1 {{ t('nav.maps') }} · {{ electionLabel(key) }}
ElectionContext
Panel(:title="office.name" :state="data" :election="key" wide)
  Field(v-if="data.data.map" :label="t('maps.show')")
    select(:value="metric" @change="setParam('metric',$event.target.value)")
      option(v-for="m in ['winner','share','margin','blank']" :key="m" :value="m") {{ m === 'share' ? t('electionData.leadingShare') : t(`maps.metric.${m}`) }}
  GeoMap(v-if="data.data.map" :map="data.data.map" :fills="fills" :tip="tip" :label="office.name" keyboard @pick="(id) => go(open(id))")
  Notice(v-else) {{ t('electionData.mapUnavailable') }}
  DataTable(:columns="columns" :rows="data.data.leaders")
details(v-if="cfg.legacyKey" @toggle="expanded = $event.target.open")
  summary {{ t('electionData.mapDetails') }}
  CollectorMaps(v-if="expanded")
</template>
