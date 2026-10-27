<script setup vapor>
import { computed } from 'vue'
import { route, href } from '../router'
import { selectedOffice, ELECTIONS } from '../model'
import { ensureElection, totalsSql } from '../election-results'
import { useAsync } from '../use'
import { objects } from '../db'
import { int, pct } from '../format'
import { t } from '../i18n'
import { grainLabel } from '../labels'
import Panel from './Panel.vue'
import CollectorTurnout from './collector/OfficialTurnout.vue'
import Notice from './Notice.vue'
const props = defineProps({ year:String,summary:Boolean,scope:Object,officeKey:String })
const office = computed(() => selectedOffice(props.year,props.officeKey ?? route.value.params.get('office')))
const scope = computed(() => props.scope ?? {state:route.value.args[0],city_code:route.value.args[1],zone:route.value.args[2]})
const data = useAsync(() => [props.year,office.value.key,scope.value],async ([key,o,s],q) => {
  await ensureElection(key,o)
  const request = totalsSql(key,o,s)
  return objects(await q(request.sql,request.params))[0] ?? {}
})
</script>
<template lang="pug">
Panel(:title="t('turnout.title')" :state="data" :election="year" wide)
  template(v-if="data.data.installed != null")
    ul
      li {{ t('turnout.summaryAbsent', {n:int(data.data.absent),rate:pct(data.data.installed > 0 && data.data.absent != null ? data.data.absent/data.data.installed : null)}) }}
      li {{ t('turnout.summaryPresent', {n:int(data.data.present),rate:pct(data.data.installed > 0 && data.data.present != null ? data.data.present/data.data.installed : null)}) }}
      li {{ t('turnout.summaryElectorate', {n:int(data.data.eligible)}) }}
    p.muted(v-if="data.data.not_installed != null") {{ t('turnout.denominator', {n:int(data.data.installed),excluded:int(data.data.not_installed)}) }}
    p.muted(v-else) {{ t('electionData.participationBase', {n:int(data.data.installed)}) }}
  Notice(v-else) {{ t('electionData.noParticipation') }}
  p.muted(v-if="data.data.units != null") {{ t('electionData.grain', {grain:grainLabel(data.data.grain),n:int(data.data.units)}) }}
  details(v-if="office.key === 'president' && ELECTIONS[year].sources.official.includes('turnout')")
    summary {{ t('turnout.source') }}
    CollectorTurnout(:year="year" :summary="summary")
  a(v-if="summary" :href="href(year,'drill',[],{office:office.key})") {{ t('turnout.details') }}
</template>
