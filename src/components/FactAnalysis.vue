<script setup vapor>
import { computed } from 'vue'
import { route, setParam, href, go } from '../router'
import { ELECTIONS, selectedOffice } from '../model'
import { electionLabel, stateTitle } from '../labels'
import { ensureElection, candidatesSql, unitsSql, availableVoteGrains, totalsSql, placesSql, unitMetricsSql, analysisPartBytes } from '../election-results'
import { useAsync } from '../use'
import { objects } from '../db'
import { int, pct } from '../format'
import { t } from '../i18n'
import { analysisDefaultState, analysisDefaultGrain, candidateAnalysisScope, candidateDistribution } from '../analysis-context'
import { histogram } from '../benford/stats'
import { analyze } from '../benford/analysis'
import Field from './Field.vue'
import Panel from './Panel.vue'
import Notice from './Notice.vue'
import ColumnChart from './ColumnChart.vue'
import Scatter from './Scatter.vue'
import DataTable from './DataTable.vue'
import SourceBadge from './SourceBadge.vue'
import Chart from '../benford/Chart.vue'
import Stats from '../benford/Stats.vue'
import DigitTable from '../benford/DigitTable.vue'
import Explainer from '../benford/Explainer.vue'
import '../benford/benford.css'

const props = defineProps({ mode: String })
const key = computed(() => route.value.election)
const cfg = computed(() => ELECTIONS[key.value])
const office = computed(() => selectedOffice(key.value, route.value.params.get('office')))
const state = computed(() => analysisDefaultState(office.value,route.value.params.get('state')))
const city=computed(()=>route.value.params.get('city_code')??route.value.params.get('city')??'')
const scope = computed(() => ({ state: state.value === 'br' ? '' : state.value,city_code:city.value }))
const grains = computed(() => {const actual=availableVoteGrains(key.value,office.value.key);return office.value.constituencyGrain==='municipality'&&state.value!=='br'&&actual.some(g=>['municipality','zone','section'].includes(g))?actual.filter(g=>g!=='state'): [...new Set(['state',...actual])]})
const grain = computed(() => state.value==='br'&&office.value.constituencyGrain!=='national'?'state':analysisDefaultGrain(grains.value,route.value.params.get('grain'),state.value,analysisPartBytes(key.value,office.value.key,scope.value)))
const aggregate = computed(() => grain.value === 'state' && (state.value === 'br'||office.value.constituencyGrain==='municipality') && office.value.constituencyGrain !== 'national')
const base = useAsync(() => [key.value, office.value.key, state.value,city.value], async ([k, o]) => { await ensureElection(k, o, scope.value); return true })
const inputs = useAsync(() => [key.value, office.value.key, state.value,city.value, base.loading,aggregate.value], async ([k, o], q) => {
  if (base.loading || aggregate.value) return null
  const request=candidatesSql(k,o,scope.value)
  const places=placesSql(k,o,{state:scope.value.state})
  return { candidates: objects(await q(request.sql,request.params)).filter((r)=>r.votes!=null),places:objects(await q(places.sql,places.params)) }
})
const cand = computed(() => route.value.params.get('cand')??inputs.data?.candidates[0]?.cand)
const selectedCandidate = computed(() => inputs.data?.candidates.find((c)=>c.cand===cand.value))
const candidateScope = computed(() => aggregate.value ? scope.value : candidateAnalysisScope(office.value,selectedCandidate.value,scope.value))
const detailed = useAsync(() => [key.value, office.value.key, state.value, grain.value,JSON.stringify(candidateScope.value)], async ([k,o]) => { if(candidateScope.value) await ensureElection(k,o,{ ...candidateScope.value,grain:grain.value });return true })
const query = computed(() => !candidateScope.value ? null : aggregate.value ? unitMetricsSql(key.value,office.value.key,grain.value,candidateScope.value) : unitsSql(key.value,office.value.key,grain.value,candidateScope.value))
const data = useAsync(() => [key.value, office.value.key, state.value, grain.value, cand.value, base.loading, inputs.loading, detailed.loading,aggregate.value], async (_, q) => {
  if (base.loading || inputs.loading || detailed.loading) return null
  if(!query.value)return {rows:[],referenceSections:null}
  const rows=objects(await q(query.value.sql,query.value.params))
  const observed=aggregate.value ? rows.map((r)=>({...r,votes:r.candidate_total,share:null})) : candidateDistribution(rows,office.value,selectedCandidate.value,scope.value)
  let referenceSections=null
  if(grain.value==='section'){const reference=totalsSql(key.value,office.value.key,candidateScope.value);referenceSections=objects(await q(reference.sql,reference.params))[0]?.sections??null}
  return {rows:observed,referenceSections}
})
const points = computed(() => (data.data?.rows ?? []).filter((r) => aggregate.value ? r.votes!=null : r.share != null))
const maxValue = computed(() => aggregate.value ? Math.max(1,...points.value.map((r)=>Number(r.votes))) : 1)
const counts = computed(() => {
  const bins = Array(40).fill(0)
  for (const r of points.value) bins[Math.min(39, Math.floor(Number(aggregate.value?r.votes:r.share)/maxValue.value*40))]++
  return bins
})
const pos = computed(() => ({ 1: 'd1', 2: 'd2', 12: 'd12', last: 'd_last' })[route.value.params.get('digits')] ?? 'd1')
const digits = computed(() => analyze(pos.value, histogram(pos.value, points.value.map((r) => Number(r.votes))), null, null))
const candName = computed(() => aggregate.value ? t('electionAnalysis.aggregateUnits') : selectedCandidate.value?.short_name ?? selectedCandidate.value?.name ?? '')
const meaningKey = computed(() => ({ official_nominal_valid: 'electionAnalysis.nominalValid', observed_cast: 'electionAnalysis.recorded', reported_nominal: 'electionAnalysis.reported' })[data.data?.rows?.[0]?.count_meaning] ?? 'electionAnalysis.mixed')
const title = computed(() => t(props.mode === 'benford' ? 'benford.page.title' : 'analysis.title', { election: electionLabel(key.value) }))
const pick = (name,event) => {const current=route.value,params=Object.fromEntries(current.params);if(['state','office','city'].includes(name)){delete params.cand;delete params.grain;if(name!=='city'){delete params.city;delete params.city_code}}if(event.target.value)params[name]=event.target.value;else delete params[name];go(href(current.election,current.view,current.args,params),{replace:true})}
const columns = computed(() => [
  { key: 'id', label: t('electionAnalysis.unit') },
  { key: 'votes', label: t('electionAnalysis.sourceCounts'), num: true, fmt: int },
  { key: 'share', label: t('analysis.candidateShare'), num: true, fmt: (v) => pct(v) },
])
</script>
<template lang="pug">
h1 {{ title }}
SourceBadge(:election="key")
.cluster
  Field(:label="t('common.office')")
    select(:value="office.key" @change="pick('office',$event)")
      option(v-for="o in cfg.officeDefinitions" :key="o.key" :value="o.key" :selected="o.key === office.key") {{ o.name }}
  Field(:label="t('common.state')")
    select(:value="state" @change="pick('state',$event)")
      option(value="br" :selected="state === 'br'") {{ t('common.brazil') }}
      option(v-for="s in office.capabilities.states" :key="s" :value="s" :selected="s === state") {{ stateTitle(s) }}
  Field(v-if="office.constituencyGrain==='municipality'" :label="t('common.city')")
    select(:value="city" @change="pick('city',$event)")
      option(value="" :selected="!city") {{ t('common.all') }}
      option(v-for="p in inputs.data?.places??[]" :key="p.city_code" :value="p.city_code" :selected="p.city_code===city") {{ p.city_name }} · {{ p.city_code }}
  Field(:label="t('electionAnalysis.grain')")
    select(:value="grain" @change="pick('grain',$event)")
      option(v-for="g in grains" :key="g" :value="g" :selected="g === grain") {{ t(`electionAnalysis.grains.${g}`) }}
  Field(:label="t('electionData.candidate')" v-if="!aggregate")
    select(:value="cand" @change="pick('cand',$event)")
      option(v-if="cand&&!selectedCandidate&&!inputs.loading" :value="cand" selected) {{ t('canonicalComparison.unavailableSelection') }}
      option(v-for="c in inputs.data?.candidates ?? []" :key="c.cand" :value="c.cand" :selected="c.cand === cand") {{ c.short_name ?? c.name }} · {{ c.city_name ?? c.state }} · {{ c.party_label ?? '–' }} · {{ c.number ?? '–' }}
Notice(v-if="cand&&!selectedCandidate&&!inputs.loading&&!aggregate") {{ t('canonicalComparison.unavailableSelection') }}
p.muted {{ t(meaningKey) }}
Notice(v-if="aggregate") {{ t('electionAnalysis.aggregateUnitsNote') }}
Notice(v-if="grain==='section'&&data.data") {{ data.data.referenceSections==null?t('electionAnalysis.sectionReferenceUnknown',{n:int(data.data.rows.length)}):t('electionAnalysis.sectionCoverage',{n:int(data.data.rows.length),reference:int(data.data.referenceSections)}) }}
Notice {{ grain==='section'?t('electionAnalysis.sectionGrain'):t('electionAnalysis.sourceGrain', { grain: grain ? t(`electionAnalysis.grains.${grain}`) : '–' }) }}
.grid-auto
  Panel(:title="t('analysis.histTitle')" :state="data" :election="key" wide v-if="mode === 'analysis'")
    ColumnChart(:label="t('analysis.histTitle')" :values="counts" :labels="Array.from({length:40},(_,i)=>aggregate?int(i/40*maxValue):pct(i/40))" :tick="int" :fmt="int")
    p.muted {{ aggregate?t('electionAnalysis.aggregateN',{n:int(points.length)}):t('electionAnalysis.histogramNote', { n: int(points.length), candidate: candName }) }}
  Panel(:title="t(aggregate?'electionAnalysis.aggregateScatter':'analysis.scatterTitle')" :state="data" :election="key" v-if="mode === 'analysis'")
    Scatter(:points="points.map(r=>aggregate?[r.eligible,r.votes]:[r.candidate_total,r.share])" :x-label="t('electionAnalysis.sourceCounts')" :y-label="aggregate?t('electionAnalysis.sourceCounts'):t('analysis.candidateShare')")
  Panel(:title="t('electionAnalysis.observed')" :state="data" :election="key" wide v-if="mode === 'analysis'")
    DataTable(:columns="columns" :rows="points.toSorted((a,b)=>b.share-a.share).slice(0,100)")
  Panel(:title="t('benford.page.title', { election: electionLabel(key) })" :state="data" :election="key" wide v-if="mode === 'benford'")
    Field(:label="t('electionAnalysis.digits')")
      select(:value="route.params.get('digits') ?? '1'" @change="pick('digits',$event)")
        option(value="1" :selected="pos === 'd1'") {{ t('electionAnalysis.first') }}
        option(value="2" :selected="pos === 'd2'") {{ t('electionAnalysis.second') }}
        option(value="12" :selected="pos === 'd12'") {{ t('electionAnalysis.firstTwo') }}
    Notice(kind="warning") {{ t('benford.page.caution') }}
    Chart(v-if="digits.n" :result="digits" :title="candName")
    Stats(:result="digits")
    DigitTable(:result="digits")
    p.muted {{ t('electionAnalysis.noSimulation') }}
  Panel(:title="t('common.openInConsole')" :election="key" wide v-if="query")
    pre {{ query.sql }}
    p.muted {{ JSON.stringify(query.params) }}
  Explainer(v-if="mode === 'benford'" mode="observed")
</template>
