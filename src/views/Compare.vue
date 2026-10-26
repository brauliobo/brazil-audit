<script setup vapor>
import { computed } from 'vue'
import { transferIndex } from '../transfers'
import { route, setParam, href } from '../router'
import { ELECTION_LIST, UFS } from '../model'
import { electionLabel, stateTitle } from '../labels'
import { t } from '../i18n'
import { tables, parts, ensureSmall, ensure } from '../data'
import { objects } from '../db'
import { useAsync } from '../use'
import { int, pct, signed, num, hms } from '../format'
import { competitionQuery, comparisonTargetsQuery } from '../comparison-queries'
import { sectionComparison, benfordComparison } from '../comparison-special'
import { METRICS, metricOf, metricSource, metricResult, comparisonQuery } from '../comparison'
import HistoricalComparison from '../components/HistoricalComparison.vue'
import TransferComparison from '../components/TransferComparison.vue'
import ButtonGroup from '../components/ButtonGroup.vue'
import Panel from '../components/Panel.vue'
import Field from '../components/Field.vue'
import DataTable from '../components/DataTable.vue'
import BarList from '../components/BarList.vue'

const modes = computed(() => ['indicators','history',...(transferIndex?.contests?.length ? ['flows'] : [])])
const mode = computed(() => route.value.params.get('comparison_mode') ?? 'indicators')
const selected = computed(() => metricOf(route.value.params.get('metric'))?.id ?? 'abstention_rate')
const metric = computed(() => metricOf(selected.value))
const state = computed(() => route.value.params.get('state') ?? '')
const city = computed(() => route.value.params.get('city') ?? '')
const office = computed(() => {
  const value = Number(route.value.params.get('office') ?? (metric.value.source === 'seats' ? 6 : 1))
  return metric.value.source === 'seats' && ![5,6,7,8].includes(value) ? 6 : value
})
const turn = computed(() => route.value.params.get('turn') ?? '')
const elections = computed(() => ELECTION_LIST.filter((e) => !turn.value || String(e.turn) === turn.value))
const selectionKey = computed(() => ELECTION_LIST.map((e) => route.value.params.get(`candidate_${e.key}`) ?? '').join('|'))
const digit = computed(() => ['d1','d2','d12','d_last'].includes(route.value.params.get('digit')) ? route.value.params.get('digit') : 'd1')
const unit = computed(() => route.value.params.get('unit') === 'city' ? 'city' : 'section')
const hasTargets = computed(() => metric.value.source === 'benford' || ['candidate_votes','candidate_share','candidate_rank','party_votes','party_share'].includes(selected.value))
const allOffices = [...new Set(ELECTION_LIST.flatMap((e) => e.offices))]
const pick = (key, event) => { setParam(key, event.target.value); if (key === 'state') setParam('city', null) }
const cityOptions = useAsync(() => [state.value], async ([s], q) => {
  if (!s) return []
  await ensure('mun_map')
  return objects(await q('select city from mun_map where state = $1 order by city', [s]))
})
const targetOptions = useAsync(() => [state.value,city.value,office.value,selected.value,turn.value,mode.value], async ([uf,municipality,cargo],q) => {
  if (mode.value !== 'indicators' || !hasTargets.value) return {}
  await ensure('cands')
  const options = {}
  for (const e of elections.value) {
    if (!e.offices.includes(cargo) || (metric.value.source === 'benford' && !uf && cargo !== 1)) { options[e.key] = []; continue }
    await ensureSmall(e.key,'res','residual')
    options[e.key] = objects(await q(comparisonTargetsQuery(e,e.hasResidual ? 'resx' : 'res',selected.value.startsWith('party_')),[uf,municipality,cargo]))
  }
  return options
})
const data = useAsync(() => [selected.value, state.value, city.value, office.value, turn.value,selectionKey.value,digit.value,unit.value,mode.value], async ([id, uf, municipality, cargo], q) => {
  if (mode.value !== 'indicators') return {rows:[],bars:[]}
  const rows = []
  for (const election of elections.value) {
    const available = new Set(Object.keys(tables()).filter((table) => parts(table, election.key).length))
    const source = metricSource(id, election, available)
    const supportedOffice = !['results','seats','competition','benford'].includes(metricOf(id).source) || election.offices.includes(cargo)
    if (!source || !supportedOffice || (source === 'seats' && municipality)) {
      rows.push({ election: election.key, label: electionLabel(election.key), value: null, status: t('compare.unavailable') })
      continue
    }
    const target = route.value.params.get(`candidate_${election.key}`) ?? ''
    let result
    if (source === 'section_stats') result = await sectionComparison(id,election,uf,municipality)
    else if (source === 'benford') result = await benfordComparison(id,election,uf,municipality,cargo,target,digit.value,unit.value,q)
    else {
      const competition = metricOf(id).source === 'competition'
      await ensureSmall(election.key, competition ? 'res' : source === 'totx' ? 'tot' : source, ...(source === 'totx' || source === 'resx' ? ['residual'] : []), ...(source === 'sgf' ? ['sgz'] : []))
      if (competition) await ensure('cands')
      const [r] = objects(await q(competition ? competitionQuery(id,election,source) : comparisonQuery(id,election,source), [uf,municipality,cargo,...(competition ? [target] : [])]))
      result = { ...r,...metricResult(id,r),target:r.target === '__unknown_party__' ? t('compare.unknownParty') : r.target }
    }
    rows.push({ election:election.key,label:electionLabel(election.key),...result,source,status:result?.records ? t(`compare.sources.${source}`) : t('compare.noMatch') })
  }
  const valid = rows.filter((r) => r.value != null)
  const first = valid[0]?.value
  for (const row of rows) row.change = row.value == null || first == null ? null : row.value - first
  return { rows, bars: valid.map((r) => ({ label: r.label, value: r.value, text: show(r.value), href: href(r.election, metric.value.family === 'operation' ? 'time' : 'overview') })) }
})
const show = (value) => value == null ? '–' : metric.value.rate ? pct(value,2) : metric.value.clock ? hms(Math.round(value)) : metric.value.decimal ? (selected.value === 'benford_p' ? value === 0 ? t('compare.belowPrecision') : value.toExponential(3) : num(value,4)) : metric.value.seconds ? num(value,1) : int(value)
const columns = computed(() => [
  { key: 'label', label: t('compare.election') },
  { key: 'value', label: t('compare.value'), num: true, fmt: show },
  { key: 'change', label: t('compare.change'), num: true, fmt: (v) => v == null ? '–' : metric.value.rate ? `${signed(v * 100, 2)} ${t('compare.pp')}` : signed(v) },
  { key: 'numerator', label: t('compare.numerator'), num: true, fmt: int },
  { key: 'denominator', label: t('compare.denominator'), num: true, fmt: int },
  { key: 'target', label: t('compare.target') },
  { key: 'baseline', label: t('compare.baseline') },
  { key: 'status', label: t('compare.source') },
])
const csv = computed(() => !data.data ? '' : 'data:text/csv;charset=utf-8,' + encodeURIComponent([
  ['election','metric','state','city','office','value','numerator','denominator','source','target','baseline','digit','unit'],
  ...data.data.rows.map((r) => [r.election,selected.value,state.value,city.value,office.value,r.value,r.numerator,r.denominator,r.source,r.target,r.baseline,digit.value,unit.value]),
].map((r) => r.map((v) => `"${String(v ?? '').replaceAll('"','""')}"`).join(',')).join('\n')))
</script>

<template lang="pug">
h1 {{ t('compare.title') }}
p.muted {{ t('compare.intro') }}
ButtonGroup(:label="t('compare.mode')" :value="mode" :items="modes.map((value) => ({value,label:t(`compare.modes.${value}`)}))" @change="setParam('comparison_mode',$event)")
HistoricalComparison(v-if="mode === 'history'")
TransferComparison(v-else-if="mode === 'flows'")
template(v-else)
  .cluster
    Field(:label="t('compare.indicator')")
      select(:value="selected" @change="pick('metric', $event)")
        optgroup(v-for="family in ['participation','results','competition','operation','signals','statistical','representation']" :key="family" :label="t(`compare.families.${family}`)")
          option(v-for="m in METRICS.filter((item) => item.family === family)" :key="m.id" :value="m.id") {{ t(`compare.metrics.${m.id}`) }}
    Field(:label="t('common.state')")
      select(:value="state" @change="pick('state', $event)")
        option(value="") {{ t('common.brazil') }}
        option(v-for="uf in UFS" :key="uf" :value="uf") {{ stateTitle(uf) }}
    Field(v-if="state" :label="t('common.city')")
      select(:value="city" @change="pick('city', $event)")
        option(value="") {{ t('common.allCities') }}
        option(v-for="r in cityOptions.data ?? []" :key="r.city" :value="r.city") {{ r.city }}
    Field(v-if="['results','seats','competition','benford'].includes(metric.source)" :label="t('common.office')")
      select(:value="office" @change="pick('office', $event)")
        option(v-for="o in allOffices.filter((value) => metric.source !== 'seats' || [5,6,7,8].includes(value))" :key="o" :value="o") {{ t(`offices.${o}`) }}
    Field(:label="t('compare.round')")
      select(:value="turn" @change="pick('turn', $event)")
        option(value="") {{ t('compare.allRounds') }}
        option(value="1") {{ t('election.turn', { turn: 1 }) }}
        option(value="2") {{ t('election.turn', { turn: 2 }) }}
  .cluster(v-if="metric.source === 'benford'")
    Field(:label="t('compare.digit')")
      select(:value="digit" @change="pick('digit', $event)")
        option(v-for="d in ['d1','d2','d12','d_last']" :key="d" :value="d") {{ t(`compare.digits.${d}`) }}
    Field(:label="t('compare.unit')")
      select(:value="unit" @change="pick('unit', $event)")
        option(value="section") {{ t('compare.sectionUnit') }}
        option(value="city") {{ t('compare.cityUnit') }}
  details(v-if="hasTargets")
    summary {{ t('compare.targets') }}
    p.muted {{ t('compare.targetNote') }}
    .cluster
      Field(v-for="e in elections" :key="e.key" :label="electionLabel(e.key)")
        select(:value="route.params.get(`candidate_${e.key}`) ?? ''" @change="pick(`candidate_${e.key}`, $event)")
          option(value="") {{ t(metric.source === 'benford' ? 'compare.nominalTarget' : 'compare.leaderTarget') }}
          template(v-if="metric.source === 'benford'")
            option(value="branco") {{ t('compare.metrics.blank_votes') }}
            option(value="nulo") {{ t('compare.metrics.null_votes') }}
          option(v-for="candidate in targetOptions.data?.[e.key] ?? []" :key="candidate.cand" :value="candidate.cand") {{ candidate.label ?? candidate.cand }} · {{ candidate.cand }}
  p.muted {{ t(`compare.notes.${metric.source}`) }}
  Panel(:title="t(`compare.metrics.${selected}`)" :state="data" :election="route.election" wide)
    BarList(v-if="!metric.clock && data.data.bars.every((r) => r.value >= 0)" :items="data.data.bars")
    p.muted {{ t('compare.definition') }}
    DataTable(:columns="columns" :rows="data.data.rows")
    a(:href="csv" download="comparison.csv") {{ t('compare.download') }}
  details
    summary {{ t('compare.more') }}
    p {{ t('compare.moreNote') }}
    .cluster
      a.btn.btn--ghost(:href="href(route.election, 'benford')") {{ t('nav.benford') }}
      a.btn.btn--ghost(:href="href(route.election, 'signals')") {{ t('nav.signals') }}
      a.btn.btn--ghost(:href="href(route.election, 'sql')") {{ t('nav.sql') }}
</template>
