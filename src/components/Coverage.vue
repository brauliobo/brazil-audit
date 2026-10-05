<script setup vapor>
import { computed, ref } from 'vue'
import { STATE_NAMES } from '../model'
import { ensure, ensureDefault, loadedParts, parts } from '../data'
import { useAsync } from '../use'
import { objects } from '../db'
import { int, pct } from '../format'
import Panel from './Panel.vue'
import DataTable from './DataTable.vue'

// 2026: own sections (TSE configs) vs sections with published results; 2022: every section of the dump.
const props = defineProps({ year: String })
const PAGE = 15
const uf = ref('')
const page = ref(0)
const is26 = computed(() => props.year === '2026')

const coverage = useAsync(() => [props.year, loadedParts('votes_2022').length], async ([y], q) => {
  if (y === '2022') {
    await ensureDefault('votes_2022')
    const [r] = objects(await q('select sum(sections) stored from tot_2022'))
    return { rows: [], stored: r.stored, parts: loadedParts('votes_2022').length, total: parts('votes_2022').length }
  }
  await ensure('cov_2026')
  const rows = objects(await q('select state, own, stored, aggregated, missing from cov_2026 order by state'))
  const sum = (k) => rows.reduce((t, r) => t + r[k], 0)
  return { rows, own: sum('own'), stored: sum('stored'), aggregated: sum('aggregated'), missing: sum('missing') }
})

const lost = useAsync(() => [uf.value, page.value, coverage.data], async ([u, p], q) => {
  if (!is26.value || !coverage.data) return null
  await ensure('miss_2026')
  const rows = objects(await q(`select state, city, zone, section, count(*) over () total from miss_2026 where $1::text = '' or state = $1
    order by state, city, zone, section limit ${PAGE} offset ${p * PAGE}`, [u]))
  return { rows, total: rows[0]?.total ?? 0 }
})

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
  template(v-if="is26")
    p
      b {{ int(coverage.data.stored) }}
      |  de {{ int(coverage.data.own) }} seções ({{ pct(coverage.data.stored / coverage.data.own, 2) }}) têm resultado neste dump; {{ int(coverage.data.missing) }} não tiveram os arquivos publicados pelo TSE.
    p.muted {{ int(coverage.data.aggregated) }} seções agregadas não têm arquivos próprios: seus votos já estão contados na seção principal e não contam como faltantes. Os totais abaixo cobrem as seções com resultado (o TSE totalizou 100%).
    details
      summary Por UF
      DataTable(:columns="stateCols" :rows="coverage.data.rows")
    details
      summary Seções sem resultado ({{ int(coverage.data.missing) }})
      .controls
        label
          | UF
          select(@change="pickState")
            option(value="") todas
            option(v-for="r in coverage.data.rows.filter((x) => x.missing)" :key="r.state" :value="r.state") {{ r.state.toUpperCase() }} ({{ r.missing }})
      DataTable(v-if="lost.data" :columns="lostCols" :rows="lost.data.rows" :page="page" :size="15" :total="Number(lost.data.total)" @page="page = $event")
  template(v-else)
    p
      b {{ int(coverage.data.stored) }}
      |  de 472.027 seções do dump carregadas no navegador ({{ coverage.data.parts }}/{{ coverage.data.total }} UFs). O dump de 2022 tem só os votos nominais de Lula e Bolsonaro.
</template>
