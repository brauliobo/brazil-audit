<script setup vapor>
import { computed } from 'vue'
import { route, setParam, href } from '../router'
import { ELECTIONS, selectedOffice } from '../model'
import { electionLabel, stateTitle } from '../labels'
import { ensureElection, candidatesSql, unitsSql, availableVoteGrains, unitMetricsSql, analysisPartBytes } from '../election-results'
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
const scope = computed(() => ({ state: state.value === 'br' ? '' : state.value }))
const grains = computed(() => availableVoteGrains(key.value,office.value.key))
const grain = computed(() => analysisDefaultGrain(grains.value,route.value.params.get('grain'),state.value,analysisPartBytes(key.value,office.value.key,scope.value)))
const aggregate = computed(() => grain.value === 'state' && state.value === 'br' && office.value.constituencyGrain !== 'national')
const base = useAsync(() => [key.value, office.value.key, state.value], async ([k, o]) => { await ensureElection(k, o, scope.value); return true })
const inputs = useAsync(() => [key.value, office.value.key, state.value, base.loading,aggregate.value], async ([k, o], q) => {
  if (base.loading || aggregate.value) return null
  const request=candidatesSql(k,o,scope.value)
  return { candidates: objects(await q(request.sql,request.params)).filter((r)=>r.votes!=null) }
})
const cand = computed(() => inputs.data?.candidates.some((c) => c.cand === route.value.params.get('cand')) ? route.value.params.get('cand') : inputs.data?.candidates[0]?.cand)
const selectedCandidate = computed(() => inputs.data?.candidates.find((c)=>c.cand===cand.value))
const candidateScope = computed(() => aggregate.value ? scope.value : candidateAnalysisScope(office.value,selectedCandidate.value,scope.value))
const detailed = useAsync(() => [key.value, office.value.key, state.value, grain.value,JSON.stringify(candidateScope.value)], async ([k,o]) => { if(candidateScope.value) await ensureElection(k,o,{ ...candidateScope.value,grain:grain.value });return true })
const query = computed(() => !candidateScope.value ? null : aggregate.value ? unitMetricsSql(key.value,office.value.key,grain.value,candidateScope.value) : unitsSql(key.value,office.value.key,grain.value,candidateScope.value))
const data = useAsync(() => [key.value, office.value.key, state.value, grain.value, cand.value, base.loading, inputs.loading, detailed.loading,aggregate.value], async (_, q) => {
  if (base.loading || inputs.loading || detailed.loading || !query.value) return null
  const rows=objects(await q(query.value.sql,query.value.params))
  return aggregate.value ? rows.map((r)=>({...r,votes:r.candidate_total,share:null})) : candidateDistribution(rows,office.value,selectedCandidate.value,scope.value)
})
const points = computed(() => (data.data ?? []).filter((r) => aggregate.value ? r.votes!=null : r.share != null))
const maxValue = computed(() => aggregate.value ? Math.max(1,...points.value.map((r)=>Number(r.votes))) : 1)
const counts = computed(() => {
  const bins = Array(40).fill(0)
  for (const r of points.value) bins[Math.min(39, Math.floor(Number(aggregate.value?r.votes:r.share)/maxValue.value*40))]++
  return bins
})
const pos = computed(() => ({ 1: 'd1', 2: 'd2', 12: 'd12', last: 'd_last' })[route.value.params.get('digits')] ?? 'd1')
const digits = computed(() => analyze(pos.value, histogram(pos.value, points.value.map((r) => Number(r.votes))), null, null))
const candName = computed(() => aggregate.value ? t('electionAnalysis.aggregateUnits') : selectedCandidate.value?.short_name ?? selectedCandidate.value?.name ?? '')
const meaningKey = computed(() => ({ official_nominal_valid: 'electionAnalysis.nominalValid', observed_cast: 'electionAnalysis.recorded', reported_nominal: 'electionAnalysis.reported' })[data.data?.[0]?.count_meaning] ?? 'electionAnalysis.mixed')
const title = computed(() => t(props.mode === 'benford' ? 'benford.page.title' : 'analysis.title', { election: electionLabel(key.value) }))
const pick = (name, event) => setParam(name, event.target.value)
const columns = computed(() => [
  { key: 'id', label: t('electionAnalysis.unit') },
  { key: 'votes', label: t('common.nominalVotes'), num: true, fmt: int },
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
  Field(:label="t('electionAnalysis.grain')")
    select(:value="grain" @change="pick('grain',$event)")
      option(v-for="g in grains" :key="g" :value="g" :selected="g === grain") {{ t(`electionAnalysis.grains.${g}`) }}
  Field(:label="t('analysis.candidate')" v-if="!aggregate")
    select(:value="cand" @change="pick('cand',$event)")
      option(v-for="c in inputs.data?.candidates ?? []" :key="c.cand" :value="c.cand" :selected="c.cand === cand") {{ c.short_name ?? c.name }} · {{ c.city_name ?? c.state }} · {{ c.party_label ?? '–' }} · {{ c.number ?? '–' }}
p.muted {{ t(meaningKey) }}
Notice(v-if="aggregate") {{ t('electionAnalysis.aggregateUnitsNote') }}
Notice {{ t('electionAnalysis.sourceGrain', { grain: grain ? t(`electionAnalysis.grains.${grain}`) : '–' }) }}
.grid-auto
  Panel(:title="t('analysis.histTitle')" :state="data" :election="key" wide v-if="mode === 'analysis'")
    ColumnChart(:label="t('analysis.histTitle')" :values="counts" :labels="Array.from({length:40},(_,i)=>aggregate?int(i/40*maxValue):pct(i/40))" :tick="int" :fmt="int")
    p.muted {{ t('electionAnalysis.histogramNote', { n: int(points.length), candidate: candName }) }}
  Panel(:title="t('analysis.scatterTitle')" :state="data" :election="key" v-if="mode === 'analysis'")
    Scatter(:points="points.map(r=>aggregate?[r.eligible,r.votes]:[r.candidate_total,r.share])" :x-label="t('common.nominalVotes')" :y-label="t('analysis.candidateShare')")
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
  Explainer(v-if="mode === 'benford'")
</template>
