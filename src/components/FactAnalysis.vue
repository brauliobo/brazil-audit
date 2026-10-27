<script setup vapor>
import { computed } from 'vue'
import { route, setParam, href } from '../router'
import { ELECTIONS, selectedOffice } from '../model'
import { electionLabel, stateTitle } from '../labels'
import { ensureElection, candidatesSql, unitsSql, voteGrainsSql } from '../election-results'
import { useAsync } from '../use'
import { objects } from '../db'
import { int, pct } from '../format'
import { t } from '../i18n'
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
const state = computed(() => route.value.params.get('state') || '')
const scope = computed(() => ({ state: state.value }))
const base = useAsync(() => [key.value, office.value.key, state.value], async ([k, o]) => { await ensureElection(k, o, scope.value); return true })
const inputs = useAsync(() => [key.value, office.value.key, state.value, base.loading], async ([k, o], q) => {
  if (base.loading) return null
  const candidates = candidatesSql(k, o, scope.value)
  const grains = voteGrainsSql(k, o, scope.value)
  const [c, g] = await Promise.all([q(candidates.sql, candidates.params), q(grains.sql, grains.params)])
  return { candidates: objects(c), grains: objects(g).map((r) => r.grain) }
})
const grains = computed(() => inputs.data?.grains ?? [])
const grain = computed(() => grains.value.includes(route.value.params.get('grain')) ? route.value.params.get('grain') : ['section', 'zone', 'municipality', 'state'].find((g) => grains.value.includes(g)))
const cand = computed(() => inputs.data?.candidates.some((c) => c.cand === route.value.params.get('cand')) ? route.value.params.get('cand') : inputs.data?.candidates[0]?.cand)
const query = computed(() => grain.value ? unitsSql(key.value, office.value.key, grain.value, scope.value) : null)
const data = useAsync(() => [key.value, office.value.key, state.value, grain.value, cand.value, base.loading, inputs.loading], async (_, q) => {
  if (base.loading || inputs.loading || !query.value || !cand.value) return null
  const result = objects(await q(query.value.sql, query.value.params))
  return [...Map.groupBy(result, (r) => r.id)].map(([id, rows]) => {
    const first = rows[0], votes = rows.find((r) => r.cand === cand.value)?.votes ?? 0
    return { ...first, id, votes, share: first.valid > 0 ? votes / first.valid : null }
  })
})
const points = computed(() => (data.data ?? []).filter((r) => r.share != null))
const counts = computed(() => {
  const bins = Array(40).fill(0)
  for (const r of points.value) bins[Math.min(39, Math.floor(r.share * 40))]++
  return bins
})
const pos = computed(() => ({ 1: 'd1', 2: 'd2', 12: 'd12', last: 'd_last' })[route.value.params.get('digits')] ?? 'd1')
const digits = computed(() => analyze(pos.value, histogram(pos.value, points.value.map((r) => r.votes)), null, null))
const candName = computed(() => inputs.data?.candidates.find((c) => c.cand === cand.value)?.short_name ?? '')
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
      option(v-for="o in cfg.officeDefinitions" :key="o.key" :value="o.key") {{ o.name }}
  Field(:label="t('common.state')")
    select(:value="state" @change="pick('state',$event)")
      option(value="") {{ t('common.brazil') }}
      option(v-for="s in office.capabilities.states" :key="s" :value="s") {{ stateTitle(s) }}
  Field(:label="t('electionAnalysis.grain')")
    select(:value="grain" @change="pick('grain',$event)")
      option(v-for="g in grains" :key="g" :value="g") {{ t(`electionAnalysis.grains.${g}`) }}
  Field(:label="t('analysis.candidate')")
    select(:value="cand" @change="pick('cand',$event)")
      option(v-for="c in inputs.data?.candidates ?? []" :key="c.cand" :value="c.cand") {{ c.short_name }} · {{ c.party ?? '–' }} · {{ c.number ?? '–' }}
Notice {{ t('electionAnalysis.sourceGrain', { grain: grain ? t(`electionAnalysis.grains.${grain}`) : '–' }) }}
.grid-auto
  Panel(:title="t('analysis.histTitle')" :state="data" :election="key" wide v-if="mode === 'analysis'")
    ColumnChart(:label="t('analysis.histTitle')" :values="counts" :labels="Array.from({length:40},(_,i)=>pct(i/40))" :tick="int" :fmt="int")
    p.muted {{ t('electionAnalysis.histogramNote', { n: int(points.length), candidate: candName }) }}
  Panel(:title="t('analysis.scatterTitle')" :state="data" :election="key" v-if="mode === 'analysis'")
    Scatter(:points="points.map(r=>[r.valid,r.share])" :x-label="t('common.nominalVotes')" :y-label="t('analysis.candidateShare')")
  Panel(:title="t('electionAnalysis.observed')" :state="data" :election="key" wide v-if="mode === 'analysis'")
    DataTable(:columns="columns" :rows="points.toSorted((a,b)=>b.share-a.share).slice(0,100)")
  Panel(:title="t('benford.page.title', { election: electionLabel(key) })" :state="data" :election="key" wide v-if="mode === 'benford'")
    Field(:label="t('electionAnalysis.digits')")
      select(:value="route.params.get('digits') ?? '1'" @change="pick('digits',$event)")
        option(value="1") {{ t('electionAnalysis.first') }}
        option(value="2") {{ t('electionAnalysis.second') }}
        option(value="12") {{ t('electionAnalysis.firstTwo') }}
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
