<script setup vapor>
import { computed } from 'vue'
import { route, href, go, setParam } from '../router'
import { ELECTIONS, STATE_NAMES, OTHERS, candJoin } from '../model'
import { ensure } from '../data'
import { useAsync } from '../use'
import { objects } from '../db'
import { int, num, pct } from '../format'
import Panel from '../components/Panel.vue'
import Field from '../components/Field.vue'
import Notice from '../components/Notice.vue'
import BarList from '../components/BarList.vue'
import Coverage from '../components/Coverage.vue'
import DataTable from '../components/DataTable.vue'
import ResidualSwitch from '../components/ResidualSwitch.vue'
import Polarization from '../components/Polarization.vue'
import WinnerMap from '../components/WinnerMap.vue'
import { loadGeo } from '../geo'
import { ensureRollups, residualOn, rollup, stateWinners, unitSql, unitsOf } from '../results'

const year = computed(() => route.value.election)
const cfg = computed(() => ELECTIONS[year.value])
const office = computed(() => Number(route.value.params.get('office') ?? 1))
// totals come from the small rollups (tot_/res_): 2026 loads them whole, 2022 derives them from its section parts
const base = useAsync(() => [year.value], async ([y]) => { await ensureRollups(y); return true })

// difference between our totals and the official candidate totals, the sections without published files (coverage) and, when
// the residual is on, the official municipality totals added for them and the cities whose official file could not be used
async function officialGap(rows, q) {
  const official = rows.reduce((t, r) => t + (r.official ?? 0), 0)
  if (!official) return null
  const ours = rows.filter((r) => r.official).reduce((t, r) => t + r.votes, 0)
  await Promise.all(['cov_2026', 'residual_2026', 'residual_skipped_2026'].map((t) => ensure(t)))
  const [c] = objects(await q('select sum(missing) missing from cov_2026'))
  const [r] = objects(await q(`select coalesce(sum(votes) filter (where number not in ('branco', 'nulo')), 0) votes,
    (select coalesce(sum(m), 0) from (select max(sections_missing) m from residual_2026 where office = 1 group by uf, city, zone) t) sections from residual_2026 where office = 1`))
  const skipped = objects(await q(`select uf, city, reason from residual_skipped_2026 where office = 1 order by uf, city`))
  return { votes: ours - official, share: (ours - official) / official, missing: c.missing, residual: residualOn.value ? r : null, skipped }
}

// the two leaders of each election's presidential race, from the official totals (independent of the dump's coverage)
const polarization = useAsync(() => [base.loading], async (_, q) => {
  if (base.loading) return null
  const rows = objects(await q(`select election, short_name name, party, official_votes::float8 / sum(official_votes) over (partition by election) share from cands
    where office = 1 and uf = 'br' and official_votes is not null order by election desc, official_votes desc`))
  return Object.entries(Object.groupBy(rows, (r) => r.election)).sort(([a], [b]) => b - a).map(([e, l]) => ({ election: `${e} · ${ELECTIONS[e].label.split('· ')[1]}`, a: l[0], b: l[1] }))
})
const ufmap = useAsync(() => [year.value, base.loading, residualOn.value], async ([y], q) => {
  if (base.loading) return null
  const [rows, map, winners] = await Promise.all([q(unitSql(y, 'uf'), [1, '']), loadGeo('uf'), stateWinners(q, y)])
  return { units: unitsOf(rows), map, abroad: winners.find((r) => r.state === 'zz' && r.rn === 1) }
})

const PARTY = `left join (select substr(n,1,2) num, max(party) party from cands where election=$2 and office>1 group by 1) p on p.num = substr(r.cand,1,2)`
const results = useAsync(() => [year.value, office.value, base.loading, residualOn.value], async ([y, o], q) => {
  if (base.loading) return null
  const { res, tot } = rollup(y)
  const sql = o === 1
    ? `select coalesce(c.n, '-') cand, coalesce(max(c.short_name), '${OTHERS}') name, max(c.party) party, sum(r.votes) votes, max(c.official_votes) official, sum(sum(r.votes)) over () total
       from ${res} r ${candJoin(y, 'r')} where r.office = $1 group by 1 order by votes desc limit 20`
    : `select substr(r.cand,1,2) cand, coalesce(max(p.party), '${OTHERS}') name, max(p.party) party, sum(r.votes) votes, null official, sum(sum(r.votes)) over () total
       from ${res} r ${PARTY} where r.office = $1 group by 1 order by votes desc limit 20`
  const rows = objects(await q(sql, o === 1 ? [o] : [o, y]))
  const gap = o === 1 ? await officialGap(rows, q) : null
  const [t] = objects(await q(`select sum(sections) sections, sum(nominal) nominal, sum(blank) blank, sum(nul) nul from ${tot} where office = $1`, [o]))
  return { rows, gap, ...t }
})

const states = useAsync(() => [year.value, office.value, base.loading, residualOn.value], async ([y, o], q) => {
  if (base.loading) return null
  return objects(await q(`select state, sum(sections) sections, sum(nominal) nominal, sum(blank) blank, sum(nul) nul from ${rollup(y).tot} where office = $1 group by state order by state`, [o]))
})

const items = computed(() => results.data.rows.map((r) => ({
  label: `${r.name} ${r.party && r.party !== r.name ? `(${r.party})` : ''} ${r.cand === '-' ? '' : `· ${r.cand}`}`,
  value: r.votes,
  text: `${int(r.votes)} · ${pct(r.votes / r.total)}${r.official ? ` · oficial ${int(r.official)}` : ''}`,
})))
const signed = (n, d = 0) => `${n < 0 ? '−' : '+'}${num(Math.abs(n), d)}`
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
.cluster(v-if="year === '2026'")
  ResidualSwitch
.grid-auto
  #cobertura.span-all
    Coverage(:year="year")
  Panel(title="Resultado nacional" :state="results" :election="year" wide)
    Field(v-if="Object.keys(cfg.offices).length > 1" label="Cargo")
      select(:value="office" @change="setParam('office', $event.target.value)")
        option(v-for="(name, id) in cfg.offices" :key="id" :value="id" :selected="Number(id) === office") {{ name }}
    p.muted(v-if="office !== 1") Votos agregados por partido (dois primeiros dígitos do número); governador e senador somam todas as UFs.
    BarList(:items="items")
    template(v-if="results.data.gap")
      Notice(v-if="results.data.gap.residual")
        | Os totais incluem {{ int(results.data.gap.residual.votes) }} votos de {{ int(results.data.gap.residual.sections) }} seções que o TSE não publicou, tomados do total oficial de cada município (sem detalhe por seção).&nbsp;
        a(href="#cobertura") ver Cobertura dos dados
      Notice(v-if="results.data.gap.votes" kind="warning")
        template(v-if="results.data.gap.residual") Diferença restante para o oficial: {{ signed(results.data.gap.votes) }} votos ({{ signed(results.data.gap.share * 100, 2) }}%){{ results.data.gap.skipped.length ? ` · municípios cujo total oficial não pôde ser usado (não totalizado, desatualizado ou ausente): ${results.data.gap.skipped.length}` : '' }}.
        template(v-else) Diferença para o oficial: {{ signed(results.data.gap.votes) }} votos ({{ signed(results.data.gap.share * 100, 2) }}%) · seções sem arquivo publicado: {{ int(results.data.gap.missing) }}.
    p.muted {{ int(results.data.sections) }} seções · nominais {{ int(results.data.nominal) }}
      template(v-if="results.data.blank != null")  · brancos {{ int(results.data.blank) }} · nulos {{ int(results.data.nul) }}
    p.muted(v-if="year === '2026'") Números fora da lista de candidatos do TSE aparecem como "{{ OTHERS }}" (o site do TSE os conta como inválidos).
  Panel(title="Polarização: votos válidos dos dois mais votados" :state="polarization" :election="year")
    Polarization(:rows="polarization.data")
    p.muted Área do círculo proporcional ao percentual dos votos nominais (válidos) segundo os totais oficiais do TSE. O 1º turno de 2026 (vários candidatos) e o 2º turno de 2022 (dois) não são diretamente comparáveis.
  Panel(title="Vencedor por UF" :state="ufmap" :election="year")
    WinnerMap(:units="ufmap.data.units" :map="ufmap.data.map" grain="uf" :abroad="ufmap.data.abroad" label="Mapa do Brasil por UF, colorido pelo candidato mais votado" @pick="go(href(year, 'maps', [], { scope: 'state', uf: $event }))")
    p.muted
      | Cor do candidato mais votado em cada UF; mais forte = maior margem. Clique numa UF para ver seus municípios.&nbsp;
      a(:href="href(year, 'maps')") Ver mapas
  Panel(title="Por UF" :state="states" :election="year" wide)
    DataTable(:columns="cols" :rows="states.data")
</template>
