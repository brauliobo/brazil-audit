<script setup vapor>
import { computed } from 'vue'
import { route, href, setParam } from '../router'
import { ELECTIONS, STATE_NAMES, candVotes } from '../model'
import { ensure, ensureScope, loadedParts, parts } from '../data'
import { useAsync } from '../use'
import { objects } from '../db'
import { int, num, pct } from '../format'
import Panel from '../components/Panel.vue'
import Field from '../components/Field.vue'
import Legend from '../components/Legend.vue'
import BarList from '../components/BarList.vue'
import ColumnChart from '../components/ColumnChart.vue'
import DataTable from '../components/DataTable.vue'
import Scatter from '../components/Scatter.vue'

const BINS = 40
const year = computed(() => route.value.election)
const cfg = computed(() => ELECTIONS[year.value])
const table = computed(() => (year.value === '2022' ? 'votes_2022' : 'rdv_2026'))
const state = computed(() => route.value.params.get('state') || null)
const loaded = computed(() => loadedParts(table.value).length)

// every panel waits for the data of the scope (selected UF, or the default set) and re-runs when more parts arrive
const base = useAsync(() => [table.value, state.value], async ([t, s]) => { await ensure('cands'); await ensureScope(t, s); return true })
const candidates = useAsync(() => [year.value, state.value, base.loading, loaded.value], async ([y, s], q) => {
  if (base.loading) return null
  return objects(await q(`select cs.cand, coalesce(c.short_name, cs.cand) name, sum(cs.votes) votes from cs_${y} cs
    join cands c on c.election = ${y} and c.office = 1 and c.n = cs.cand and c.uf = 'br'
    where cs.office = 1 and ($1::text is null or cs.state = $1) group by cs.cand, c.short_name order by votes desc limit 8`, [s]))
})
const cand = computed(() => route.value.params.get('cand') ?? candidates.data?.[0]?.cand ?? null)
const run = (fn) => useAsync(() => [year.value, state.value, cand.value, base.loading, loaded.value], async (d, q) => (base.loading || !cand.value ? null : fn(d, q)))
const rows = async (q, sql, params) => objects(await q(sql, params))

const hist = run(async ([y, s, c], q) => {
  const found = await rows(q, `with v as (${candVotes(y)}) select width_bucket(votes::float8 / nominal, 0, 1.0000001, ${BINS}) b, count(*) n
    from v where nominal > 0 and ($2::text is null or state = $2) group by 1 order by 1`, [c, s])
  const counts = Array(BINS).fill(0)
  found.forEach((r) => (counts[r.b - 1] = r.n))
  return counts
})

const outliers = run(([y, s, c], q) => rows(q, `with v as (${candVotes(y)}),
  sh as (select state, city, zone, section, nominal, votes::float8 / nominal share from v where nominal >= 30 and ($2::text is null or state = $2)),
  z as (select *, (share - avg(share) over w) / nullif(stddev_samp(share) over w, 0) z, count(*) over w n from sh window w as (partition by state, city))
  select state, city, zone, section, nominal, share, z from z where n >= 8 and z is not null order by abs(z) desc limit 20`, [c, s]))

const scatter = run(async ([y, s, c], q) => (await q(`with v as (${candVotes(y)}) select nominal, votes::float8 / nominal from v
  where nominal > 0 and ($2::text is null or state = $2) order by random() limit 4000`, [c, s])).rows)

const cities = run(([y, s, c], q) => rows(q, `with v as (${candVotes(y)}) select state, city, sum(votes) votes, sum(nominal) nominal, count(*) sections,
  sum(votes)::float8 / sum(nominal) share from v where ($2::text is null or state = $2) group by state, city
  having count(*) >= 10 and sum(nominal) > 0 order by share desc limit 15`, [c, s]))

const benford = run(async ([y, s, c], q) => {
  const found = await rows(q, `with v as (${candVotes(y)}) select substr(votes::text, 1, 1)::int d, count(*) n from v
    where votes > 0 and ($2::text is null or state = $2) group by 1 order by 1`, [c, s])
  const total = found.reduce((t, r) => t + r.n, 0)
  const observed = Array.from({ length: 9 }, (_, i) => (found.find((r) => r.d === i + 1)?.n ?? 0) / total)
  const expected = Array.from({ length: 9 }, (_, i) => Math.log10(1 + 1 / (i + 1)))
  const chi2 = observed.reduce((t, o, i) => t + (total * (o - expected[i]) ** 2) / expected[i], 0)
  return { observed, expected, total, chi2 }
})

const rates = useAsync(() => [year.value, state.value, base.loading, loaded.value], async ([y, s], q) => {
  if (base.loading) return null
  if (y === '2022') return []
  return rows(q, `select state, count(*) sections, sum(blank)::float8 / nullif(sum(nominal + blank + nul), 0) blank_rate,
    sum(nul)::float8 / nullif(sum(nominal + blank + nul), 0) null_rate from sec_${y} where office = 1 and ($1::text is null or state = $1) group by state order by state`, [s])
})

const benfordLegend = computed(() => [{ color: 'var(--chart-bar)', label: 'observado' }, { color: 'var(--chart-highlight)', label: `esperado (Benford) · χ² = ${num(benford.data.chi2)} (8 gl; crítico a 5% = 15,51) · n = ${int(benford.data.total)}` }])
const pick = (key) => (e) => setParam(key, e.target.value)
const stateOptions = computed(() => parts(table.value))
const section = (r) => href(year.value, 'drill', [r.state, r.city, r.zone, r.section])
const histLabels = Array.from({ length: BINS }, (_, i) => `${(i * 100) / BINS}%`)
const cols = [
  { key: 'state', label: 'UF', fmt: (v) => v.toUpperCase() },
  { key: 'city', label: 'Município' },
  { key: 'zone', label: 'Zona' },
  { key: 'section', label: 'Seção', href: section },
  { key: 'nominal', label: 'Votos nominais', num: true, fmt: int },
  { key: 'share', label: '% candidato', num: true, fmt: (v) => pct(v) },
  { key: 'z', label: 'z-score', num: true, fmt: (v) => num(v) },
]
const cityItems = computed(() => cities.data.map((r) => ({ label: `${r.city} (${r.state.toUpperCase()})`, value: r.share, text: `${pct(r.share)} · ${int(r.sections)} seções`, href: href(year.value, 'drill', [r.state, r.city]) })))
const rateLabels = computed(() => rates.data.map((r) => r.state.toUpperCase()))
</script>

<template lang="pug">
h1 Análise · {{ cfg.label }}
.cluster
  Field(label="Escopo")
    select(:value="state ?? ''" @change="pick('state')")
      option(value="") {{ loaded }} UF(s) carregada(s)
      option(v-for="s in stateOptions" :key="s" :value="s" :selected="s === state") {{ s.toUpperCase() }} · {{ STATE_NAMES[s] }}
  Field(v-if="candidates.data" label="Candidato (presidente)")
    select(:value="cand" @change="pick('cand')")
      option(v-for="c in candidates.data" :key="c.cand" :value="c.cand" :selected="c.cand === cand") {{ c.name }} ({{ c.cand }})
.grid-auto
  Panel(title="Distribuição do percentual do candidato por seção" :state="hist" :election="year" wide)
    ColumnChart(:values="hist.data" :labels="histLabels" :tick="int" :fmt="(v) => int(v) + ' seções'")
    p.muted seções por faixa de 2,5 pontos percentuais do total de votos nominais
  Panel(title="Seções atípicas (z-score na cidade)" :state="outliers" :election="year" wide)
    p.muted Percentual do candidato na seção contra a média das seções do mesmo município (cidades com 8+ seções, 30+ votos).
    DataTable(:columns="cols" :rows="outliers.data")
  Panel(title="Votos na seção × percentual do candidato" :state="scatter" :election="year")
    Scatter(:points="scatter.data" x-label="votos nominais" y-label="% candidato")
    p.muted amostra aleatória de até 4.000 seções
  Panel(title="Municípios com maior percentual" :state="cities" :election="year")
    BarList(:items="cityItems")
  Panel(title="Primeiro dígito dos votos por seção (Benford)" :state="benford" :election="year")
    ColumnChart(:values="benford.data.observed" :labels="['1','2','3','4','5','6','7','8','9']" :line="benford.data.expected" :fmt="(v) => pct(v, 1)")
    Legend(:items="benfordLegend")
  Panel(title="Brancos e nulos por UF (presidente)" :state="rates" :election="year" wide)
    template(v-if="year === '2022'")
      p.muted O dump de 2022 só tem votos nominais por candidato (sem brancos/nulos).
    template(v-else-if="rates.data")
      ColumnChart(:values="rates.data.map((r) => r.blank_rate)" :labels="rateLabels" :fmt="(v) => pct(v, 1)")
      p.muted brancos
      ColumnChart(:values="rates.data.map((r) => r.null_rate)" :labels="rateLabels" :fmt="(v) => pct(v, 1)")
      p.muted nulos
</template>
