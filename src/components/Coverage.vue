<script setup vapor>
import { computed, ref } from 'vue'
import { ELECTIONS, inElection } from '../model'
import { officeName, stateTitle } from '../labels'
import { t } from '../i18n'
import { ensureSmall } from '../data'
import { useAsync } from '../use'
import { objects } from '../db'
import { int, pct } from '../format'
import Panel from './Panel.vue'
import Field from './Field.vue'
import Stat from './Stat.vue'
import Notice from './Notice.vue'
import DataTable from './DataTable.vue'
import RawData from './RawData.vue'

// Elections with coverage: own sections (TSE configs) vs sections with published results; the others: every section of the dump.
const props = defineProps({ year: String })
const cfg = computed(() => ELECTIONS[props.year])
const PAGE = 15
const uf = ref('')
const page = ref(0)
const covered = computed(() => cfg.value.hasCoverage)

const coverage = useAsync(() => [props.year], async ([y], q) => {
  await ensureSmall(y, 'tot', 'cov')
  if (!covered.value) {
    const [r] = objects(await q(`select sum(sections) stored, sum(blank) is null noblank from tot where office = 1 and ${inElection(y)}`))
    return { rows: [], stored: r.stored, noblank: r.noblank }
  }
  const rows = objects(await q(`select state, own, stored, aggregated, missing from cov where ${inElection(y)} order by state`))
  const sum = (k) => rows.reduce((t, r) => t + r[k], 0)
  return { rows, own: sum('own'), stored: sum('stored'), aggregated: sum('aggregated'), missing: sum('missing') }
})

const lost = useAsync(() => [uf.value, page.value, coverage.data], async ([u, p], q) => {
  if (!covered.value || !coverage.data) return null
  await ensureSmall(props.year, 'miss')
  const rows = objects(await q(`select state, city, zone, section, count(*) over () total from miss where ${inElection(props.year)} and ($1::text = '' or state = $1)
    order by state, city, zone, section limit ${PAGE} offset ${p * PAGE}`, [u]))
  return { rows, total: rows[0]?.total ?? 0 }
})

// votes taken from the official municipality totals for sections without files, per UF (president), and the cities left out
const resid = useAsync(() => [covered.value, coverage.data], async (_, q) => {
  if (!covered.value || !coverage.data || !cfg.value.hasResidual) return null
  await ensureSmall(props.year, 'residual', 'residual_skipped')
  const perUf = objects(await q(`select uf state, count(distinct city) cities, sum(m) sections, sum(v) votes from (select uf, city, zone, max(sections_missing) m,
    sum(votes) filter (where number not in ('branco', 'nulo')) v from residual where office = 1 and ${inElection(props.year)} group by 1, 2, 3) t group by 1 order by 1`))
  const skipped = objects(await q(`select uf, city, zone, office, reason from residual_skipped where ${inElection(props.year)} order by uf, city, zone, office`))
  return { perUf, skipped, added: perUf.reduce((n, r) => n + r.sections, 0) }
})
const residCols = computed(() => [
  { key: 'state', label: t('common.state'), fmt: stateTitle },
  { key: 'cities', label: t('common.city'), num: true, fmt: int },
  { key: 'sections', label: t('coverage.sectionsWithoutFile'), num: true, fmt: int },
  { key: 'votes', label: t('coverage.votesPresident'), num: true, fmt: int },
])
const skippedCols = computed(() => [
  { key: 'uf', label: t('common.state'), fmt: (v) => v.toUpperCase() },
  { key: 'city', label: t('common.city') },
  { key: 'zone', label: t('common.zone') },
  { key: 'office', label: t('common.office'), fmt: officeName },
  { key: 'reason', label: t('coverage.reason'), fmt: (v) => t(`coverage.reasons.${v}`) },
])
const stateCols = computed(() => [
  { key: 'state', label: t('common.state'), fmt: stateTitle },
  { key: 'own', label: t('coverage.ownFiles'), num: true, fmt: int },
  { key: 'stored', label: t('coverage.stored'), num: true, fmt: int },
  { key: 'missing', label: t('coverage.noResult'), num: true, fmt: int },
  { key: 'aggregated', label: t('coverage.aggregatedCol'), num: true, fmt: int },
])
const lostCols = computed(() => [
  { key: 'state', label: t('common.state'), fmt: (v) => v.toUpperCase() },
  { key: 'city', label: t('common.city') },
  { key: 'zone', label: t('common.zone') },
  { key: 'section', label: t('common.section') },
])
const pickState = (e) => { uf.value = e.target.value; page.value = 0 }
</script>

<template lang="pug">
Panel(:title="t('coverage.title')" :state="coverage" :election="year" wide)
  template(v-if="covered")
    .cluster
      Stat(:value="pct(coverage.data.stored / coverage.data.own, 2)" :label="t('coverage.withResult')")
      Stat(:value="int(coverage.data.stored)" :label="t('coverage.ofSections', { n: int(coverage.data.own) })")
      Stat(:value="int(coverage.data.missing)" :label="t('coverage.missing')")
    p.muted {{ t('coverage.aggregated', { count: coverage.data.aggregated }) }}
    details
      summary {{ t('coverage.byState') }}
      DataTable(:columns="stateCols" :rows="coverage.data.rows")
    details(v-if="resid.data && resid.data.perUf.length")
      summary {{ t('coverage.residualSummary') }}
      p.muted {{ t('coverage.residualNote') }}
      DataTable(:columns="residCols" :rows="resid.data.perUf")
      p.muted(v-if="coverage.data.missing > resid.data.added") {{ t('coverage.unmatchedNote', { count: coverage.data.missing - resid.data.added }) }}
      p.muted(v-if="resid.data.skipped.length") {{ t('coverage.skippedCount', { n: resid.data.skipped.length, president: resid.data.skipped.filter((r) => r.office === 1).length }) }}
      DataTable(v-if="resid.data.skipped.length" :columns="skippedCols" :rows="resid.data.skipped")
    details
      summary {{ t('coverage.lostSummary', { n: int(coverage.data.missing) }) }}
      .cluster
        Field(:label="t('common.state')")
          select(@change="pickState")
            option(value="") {{ t('common.all') }}
            option(v-for="r in coverage.data.rows.filter((x) => x.missing)" :key="r.state" :value="r.state") {{ r.state.toUpperCase() }} ({{ r.missing }})
      DataTable(v-if="lost.data" :columns="lostCols" :rows="lost.data.rows" :page="page" :size="15" :total="Number(lost.data.total)" @page="page = $event")
  template(v-else)
    Stat(:value="int(coverage.data.stored)" :label="t('coverage.sectionsInDump')")
    Notice(v-if="coverage.data.noblank") {{ t('coverage.noBlank') }}
  RawData(:election="year")
</template>
