<script setup vapor>
import { computed } from 'vue'
import { route, setParam, href } from '../router'
import { ELECTION_LIST, UFS } from '../model'
import { electionLabel, stateTitle } from '../labels'
import { t } from '../i18n'
import { tables, parts, ensureSmall, ensure } from '../data'
import { objects } from '../db'
import { useAsync } from '../use'
import { int, pct, signed, num } from '../format'
import { METRICS, metricOf, metricSource, metricResult, comparisonQuery } from '../comparison'
import Panel from '../components/Panel.vue'
import Field from '../components/Field.vue'
import DataTable from '../components/DataTable.vue'
import BarList from '../components/BarList.vue'

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
const allOffices = [...new Set(ELECTION_LIST.flatMap((e) => e.offices))]
const pick = (key, event) => { setParam(key, event.target.value); if (key === 'state') setParam('city', null) }
const cityOptions = useAsync(() => [state.value], async ([s], q) => {
  if (!s) return []
  await ensure('mun_map')
  return objects(await q('select city from mun_map where state = $1 order by city', [s]))
})
const data = useAsync(() => [selected.value, state.value, city.value, office.value, turn.value], async ([id, uf, municipality, cargo], q) => {
  const rows = []
  for (const election of elections.value) {
    const available = new Set(Object.keys(tables()).filter((table) => parts(table, election.key).length))
    const source = metricSource(id, election, available)
    const supportedOffice = !['results','seats'].includes(metricOf(id).source) || election.offices.includes(cargo)
    if (!source || !supportedOffice || (source === 'seats' && municipality)) {
      rows.push({ election: election.key, label: electionLabel(election.key), value: null, status: t('compare.unavailable') })
      continue
    }
    await ensureSmall(election.key, source === 'totx' ? 'tot' : source, ...(source === 'totx' ? ['residual'] : []))
    const [r] = objects(await q(comparisonQuery(id, election, source), [uf, municipality, cargo]))
    rows.push({ election: election.key, label: electionLabel(election.key), ...metricResult(id, r), source, status: Number(r.records) ? t(`compare.sources.${source}`) : t('compare.noMatch') })
  }
  const valid = rows.filter((r) => r.value != null)
  const first = valid[0]?.value
  for (const row of rows) row.change = row.value == null || first == null ? null : row.value - first
  return { rows, bars: valid.map((r) => ({ label: r.label, value: r.value, text: show(r.value), href: href(r.election, metric.value.family === 'operation' ? 'time' : 'overview') })) }
})
const show = (value) => metric.value.rate ? pct(value, 2) : int(value)
const columns = computed(() => [
  { key: 'label', label: t('compare.election') },
  { key: 'value', label: t('compare.value'), num: true, fmt: show },
  { key: 'change', label: t('compare.change'), num: true, fmt: (v) => v == null ? '–' : metric.value.rate ? `${signed(v * 100, 2)} ${t('compare.pp')}` : signed(v) },
  { key: 'numerator', label: t('compare.numerator'), num: true, fmt: int },
  { key: 'denominator', label: t('compare.denominator'), num: true, fmt: int },
  { key: 'status', label: t('compare.source') },
])
const csv = computed(() => !data.data ? '' : 'data:text/csv;charset=utf-8,' + encodeURIComponent([
  ['election','metric','state','city','office','value','numerator','denominator','source'],
  ...data.data.rows.map((r) => [r.election,selected.value,state.value,city.value,office.value,r.value,r.numerator,r.denominator,r.source]),
].map((r) => r.map((v) => `"${String(v ?? '').replaceAll('"','""')}"`).join(',')).join('\n')))
</script>

<template lang="pug">
h1 {{ t('compare.title') }}
p.muted {{ t('compare.intro') }}
.cluster
  Field(:label="t('compare.indicator')")
    select(:value="selected" @change="pick('metric', $event)")
      optgroup(v-for="family in ['participation','results','operation','representation']" :key="family" :label="t(`compare.families.${family}`)")
        option(v-for="m in METRICS.filter((item) => item.family === family)" :key="m.id" :value="m.id") {{ t(`compare.metrics.${m.id}`) }}
  Field(:label="t('common.state')")
    select(:value="state" @change="pick('state', $event)")
      option(value="") {{ t('common.brazil') }}
      option(v-for="uf in UFS" :key="uf" :value="uf") {{ stateTitle(uf) }}
  Field(v-if="state" :label="t('common.city')")
    select(:value="city" @change="pick('city', $event)")
      option(value="") {{ t('common.allCities') }}
      option(v-for="r in cityOptions.data ?? []" :key="r.city" :value="r.city") {{ r.city }}
  Field(v-if="['results','seats'].includes(metric.source)" :label="t('common.office')")
    select(:value="office" @change="pick('office', $event)")
      option(v-for="o in allOffices.filter((value) => metric.source !== 'seats' || [5,6,7,8].includes(value))" :key="o" :value="o") {{ t(`offices.${o}`) }}
  Field(:label="t('compare.round')")
    select(:value="turn" @change="pick('turn', $event)")
      option(value="") {{ t('compare.allRounds') }}
      option(value="1") {{ t('election.turn', { turn: 1 }) }}
      option(value="2") {{ t('election.turn', { turn: 2 }) }}
p.muted {{ t(`compare.notes.${metric.source}`) }}
Panel(:title="t(`compare.metrics.${selected}`)" :state="data" :election="route.election" wide)
  BarList(:items="data.data.bars")
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
