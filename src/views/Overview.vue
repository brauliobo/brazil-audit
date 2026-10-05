<script setup vapor>
import { computed } from 'vue'
import { route, href, go, setParam } from '../router'
import { ELECTIONS, STATE_NAMES, OTHERS, candJoin } from '../model'
import { ensure, ensureDefault } from '../data'
import { useAsync } from '../use'
import { objects } from '../db'
import { int, num, pct } from '../format'
import Panel from '../components/Panel.vue'
import BarList from '../components/BarList.vue'
import Coverage from '../components/Coverage.vue'
import DataTable from '../components/DataTable.vue'
import Polarization from '../components/Polarization.vue'
import TileMap from '../components/TileMap.vue'
import { stateWinners } from '../results'

const year = computed(() => route.value.election)
const cfg = computed(() => ELECTIONS[year.value])
const office = computed(() => Number(route.value.params.get('office') ?? 1))
// totals come from the small rollups (tot_/res_): 2026 loads them whole, 2022 derives them from its section parts
const base = useAsync(() => [year.value], async ([y]) => {
  await ensure('cands')
  await (y === '2022' ? ensureDefault('votes_2022') : Promise.all([ensure('tot_2026'), ensure('res_2026')]))
  return true
})

// difference between the dump and the official candidate totals, with the sections that have no published files (coverage)
async function officialGap(rows, q) {
  const official = rows.reduce((t, r) => t + (r.official ?? 0), 0)
  const dumped = rows.filter((r) => r.official).reduce((t, r) => t + r.votes, 0)
  if (!official || official === dumped) return null
  await ensure('cov_2026')
  const [c] = objects(await q('select sum(missing) missing from cov_2026'))
  return { votes: dumped - official, share: (dumped - official) / official, missing: c.missing }
}

// the two leaders of each election's presidential race, from the official totals (independent of the dump's coverage)
const polarization = useAsync(() => [base.loading], async (_, q) => {
  if (base.loading) return null
  const rows = objects(await q(`select election, short_name name, party, official_votes::float8 / sum(official_votes) over (partition by election) share from cands
    where office = 1 and uf = 'br' and official_votes is not null order by election desc, official_votes desc`))
  return Object.entries(Object.groupBy(rows, (r) => r.election)).sort(([a], [b]) => b - a).map(([e, l]) => ({ election: `${e} · ${ELECTIONS[e].label.split('· ')[1]}`, a: l[0], b: l[1] }))
})
const winners = useAsync(() => [year.value, base.loading], async ([y], q) => (base.loading ? null : stateWinners(q, y)))

const PARTY = `left join (select substr(n,1,2) num, max(party) party from cands where election=$2 and office>1 group by 1) p on p.num = substr(r.cand,1,2)`
const results = useAsync(() => [year.value, office.value, base.loading], async ([y, o], q) => {
  if (base.loading) return null
  const sql = o === 1
    ? `select coalesce(c.n, '-') cand, coalesce(max(c.short_name), '${OTHERS}') name, max(c.party) party, sum(r.votes) votes, max(c.official_votes) official, sum(sum(r.votes)) over () total
       from res_${y} r ${candJoin(y, 'r')} where r.office = $1 group by 1 order by votes desc limit 20`
    : `select substr(r.cand,1,2) cand, coalesce(max(p.party), '${OTHERS}') name, max(p.party) party, sum(r.votes) votes, null official, sum(sum(r.votes)) over () total
       from res_${y} r ${PARTY} where r.office = $1 group by 1 order by votes desc limit 20`
  const rows = objects(await q(sql, o === 1 ? [o] : [o, y]))
  const gap = o === 1 ? await officialGap(rows, q) : null
  const [t] = objects(await q(`select sum(sections) sections, sum(nominal) nominal, sum(blank) blank, sum(nul) nul from tot_${y} where office = $1`, [o]))
  return { rows, gap, ...t }
})

const states = useAsync(() => [year.value, office.value, base.loading], async ([y, o], q) => {
  if (base.loading) return null
  return objects(await q(`select state, sum(sections) sections, sum(nominal) nominal, sum(blank) blank, sum(nul) nul from tot_${y} where office = $1 group by state order by state`, [o]))
})

const items = computed(() => results.data.rows.map((r) => ({
  label: `${r.name} ${r.party && r.party !== r.name ? `(${r.party})` : ''} ${r.cand === '-' ? '' : `· ${r.cand}`}`,
  value: r.votes,
  text: `${int(r.votes)} · ${pct(r.votes / r.total)}${r.official ? ` · oficial ${int(r.official)}` : ''}`,
})))
const signed = (n, d = 0) => `${n < 0 ? '−' : '+'}${num(Math.abs(n), d)}`
const showCoverage = () => document.getElementById('cobertura').scrollIntoView({ behavior: 'smooth' })
const rate = (v, r) => (v == null ? '–' : pct(v / (r.nominal + r.blank + r.nul)))
const cols = computed(() => [
  { key: 'state', label: 'UF', href: (r) => href(year.value, 'drill', [r.state], { office: office.value }), fmt: (v) => `${v.toUpperCase()} · ${STATE_NAMES[v]}` },
  { key: 'sections', label: 'Seções', num: true, fmt: int },
  { key: 'nominal', label: 'Votos nominais', num: true, fmt: int },
  { key: 'blank', label: 'Brancos', num: true, fmt: rate },
  { key: 'nul', label: 'Nulos', num: true, fmt: rate },
])
</script>

<template lang="pug">
h1 {{ cfg.label }}
.grid
  #cobertura.full
    Coverage(:year="year")
  Panel(title="Resultado nacional" :state="results" :election="year" wide)
    label(v-if="Object.keys(cfg.offices).length > 1")
      | Cargo
      select(:value="office" @change="setParam('office', $event.target.value)")
        option(v-for="(name, id) in cfg.offices" :key="id" :value="id" :selected="Number(id) === office") {{ name }}
    p.muted(v-if="office !== 1") Votos agregados por partido (dois primeiros dígitos do número); governador e senador somam todas as UFs.
    BarList(:items="items")
    p.warn(v-if="results.data.gap")
      | Diferença para o oficial: {{ signed(results.data.gap.votes) }} votos ({{ signed(results.data.gap.share * 100, 2) }}%) · seções sem arquivo publicado: {{ int(results.data.gap.missing) }} ·&nbsp;
      a(href="#/" @click.prevent="showCoverage") ver Cobertura dos dados
    p.muted {{ int(results.data.sections) }} seções · nominais {{ int(results.data.nominal) }}
      template(v-if="results.data.blank != null")  · brancos {{ int(results.data.blank) }} · nulos {{ int(results.data.nul) }}
    p.muted(v-if="year === '2026'") Números fora da lista de candidatos do TSE aparecem como "{{ OTHERS }}" (o site do TSE os conta como inválidos).
  Panel(title="Polarização: votos válidos dos dois mais votados" :state="polarization" :election="year")
    Polarization(:rows="polarization.data")
    p.muted Área do círculo proporcional ao percentual dos votos nominais (válidos) segundo os totais oficiais do TSE. O 1º turno de 2026 (vários candidatos) e o 2º turno de 2022 (dois) não são diretamente comparáveis.
  Panel(title="Vencedor por UF" :state="winners" :election="year")
    TileMap(:rows="winners.data" @pick="go(href(year, 'drill', [$event]))")
    p.muted
      | Um quadrado por estado, colorido pelo candidato mais votado; cor mais forte = maior margem.&nbsp;
      a(:href="href(year, 'maps')") Ver mapas
  Panel(title="Por UF" :state="states" :election="year" wide)
    DataTable(:columns="cols" :rows="states.data")
</template>
