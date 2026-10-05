<script setup vapor>
import { computed, ref } from 'vue'
import { ELECTIONS, STATE_NAMES, inElection } from '../model'
import { ensureSmall } from '../data'
import { useAsync } from '../use'
import { objects } from '../db'
import { int, pct } from '../format'
import Panel from './Panel.vue'
import Field from './Field.vue'
import Stat from './Stat.vue'
import Notice from './Notice.vue'
import DataTable from './DataTable.vue'

// Elections with coverage: own sections (TSE configs) vs sections with published results; the others: every section of the dump.
const props = defineProps({ year: String })
const cfg = computed(() => ELECTIONS[props.year])
const OFFICES = computed(() => cfg.value.offices)
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
const REASONS = { not_totalized: 'total oficial ainda não totalizado', negative: 'total oficial menor que as seções que temos (arquivo desatualizado)', no_official_file: 'sem arquivo oficial do município' }
const resid = useAsync(() => [covered.value, coverage.data], async (_, q) => {
  if (!covered.value || !coverage.data || !cfg.value.hasResidual) return null
  await ensureSmall(props.year, 'residual', 'residual_skipped')
  const perUf = objects(await q(`select uf state, count(distinct city) cities, sum(m) sections, sum(v) votes from (select uf, city, zone, max(sections_missing) m,
    sum(votes) filter (where number not in ('branco', 'nulo')) v from residual where office = 1 and ${inElection(props.year)} group by 1, 2, 3) t group by 1 order by 1`))
  const skipped = objects(await q(`select uf, city, zone, office, reason from residual_skipped where ${inElection(props.year)} order by uf, city, zone, office`))
  return { perUf, skipped: skipped.map((r) => ({ ...r, reason: REASONS[r.reason] ?? r.reason })) }
})
const residCols = [
  { key: 'state', label: 'UF', fmt: (v) => `${v.toUpperCase()} · ${STATE_NAMES[v]}` },
  { key: 'cities', label: 'Municípios', num: true, fmt: int },
  { key: 'sections', label: 'Seções sem arquivo', num: true, fmt: int },
  { key: 'votes', label: 'Votos (presidente)', num: true, fmt: int },
]
const skippedCols = [
  { key: 'uf', label: 'UF', fmt: (v) => v.toUpperCase() },
  { key: 'city', label: 'Município' },
  { key: 'zone', label: 'Zona' },
  { key: 'office', label: 'Cargo', fmt: (v) => OFFICES.value[v] },
  { key: 'reason', label: 'Motivo' },
]
const stateCols = [
  { key: 'state', label: 'UF', fmt: (v) => `${v.toUpperCase()} · ${STATE_NAMES[v]}` },
  { key: 'own', label: 'Seções com arquivos próprios', num: true, fmt: int },
  { key: 'stored', label: 'Com resultado no dump', num: true, fmt: int },
  { key: 'missing', label: 'Sem resultado publicado', num: true, fmt: int },
  { key: 'aggregated', label: 'Agregadas em outra seção', num: true, fmt: int },
]
const lostCols = [
  { key: 'state', label: 'UF', fmt: (v) => v.toUpperCase() },
  { key: 'city', label: 'Município' },
  { key: 'zone', label: 'Zona' },
  { key: 'section', label: 'Seção' },
]
const pickState = (e) => { uf.value = e.target.value; page.value = 0 }
</script>

<template lang="pug">
Panel(title="Cobertura dos dados" :state="coverage" :election="year" wide)
  template(v-if="covered")
    .cluster
      Stat(:value="pct(coverage.data.stored / coverage.data.own, 2)" label="das seções com resultado neste dump")
      Stat(:value="int(coverage.data.stored)" :label="`de ${int(coverage.data.own)} seções`")
      Stat(:value="int(coverage.data.missing)" label="sem arquivos publicados pelo TSE")
    p.muted {{ int(coverage.data.aggregated) }} seções agregadas não têm arquivos próprios: seus votos já estão contados na seção principal e não contam como faltantes. Sem o acréscimo dos votos dessas seções (veja abaixo), os totais cobrem só as seções com resultado (o TSE totalizou 100%).
    details
      summary Por UF
      DataTable(:columns="stateCols" :rows="coverage.data.rows")
    details(v-if="resid.data && resid.data.perUf.length")
      summary Votos de seções sem arquivo, tomados do total oficial do município
      p.muted Cada voto aqui vem do total oficial da zona ou do município (menos o que as seções com arquivo somam), não de arquivos de seção; por isso só entram nos totais nacionais, de UF e de município e na linha de cada zona.
      DataTable(:columns="residCols" :rows="resid.data.perUf")
      p.muted(v-if="resid.data.skipped.length") Municípios/cargos sem acréscimo ({{ resid.data.skipped.length }}):
      DataTable(v-if="resid.data.skipped.length" :columns="skippedCols" :rows="resid.data.skipped")
    details
      summary Seções sem resultado ({{ int(coverage.data.missing) }})
      .cluster
        Field(label="UF")
          select(@change="pickState")
            option(value="") todas
            option(v-for="r in coverage.data.rows.filter((x) => x.missing)" :key="r.state" :value="r.state") {{ r.state.toUpperCase() }} ({{ r.missing }})
      DataTable(v-if="lost.data" :columns="lostCols" :rows="lost.data.rows" :page="page" :size="15" :total="Number(lost.data.total)" @page="page = $event")
  template(v-else)
    Stat(:value="int(coverage.data.stored)" label="seções no dump")
    Notice(v-if="coverage.data.noblank") Brancos e nulos não foram coletados nesta eleição: o dump só tem os votos nominais por candidato.
</template>
