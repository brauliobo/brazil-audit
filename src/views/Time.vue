<script setup vapor>
import { computed } from 'vue'
import { route, href, go, setParam } from '../router'
import { STATE_NAMES, BUCKET, collate } from '../model'
import { ensure, parts } from '../data'
import { useAsync } from '../use'
import { objects } from '../db'
import { clock, int, num } from '../format'
import Panel from '../components/Panel.vue'
import ColumnChart from '../components/ColumnChart.vue'
import DataTable from '../components/DataTable.vue'

const year = computed(() => route.value.election)
const args = computed(() => route.value.args)
const [state, city] = [computed(() => args.value[0] ?? null), computed(() => args.value[1] ?? null)]
const isSection = computed(() => args.value.length === 4)
const brt = computed(() => route.value.params.get('clock') !== 'local')
const rank = computed(() => route.value.params.get('rank') ?? 'fast')
const rows = async (q, sql, params) => objects(await q(sql, params))

// Scope data: the tiny city rollups are always loaded; section rows (and their results) only for the selected UF.
const base = useAsync(() => [state.value], async ([s]) => {
  await ensure('vtc_2026')
  if (s) await Promise.all([ensure('vt_2026', [s]), ensure('rdv_2026', [s])])
  return true
})
const waiting = () => base.loading

const cities = useAsync(() => [state.value, base.loading], async ([s], q) => (waiting() || !s ? [] : rows(q, `select city from vtc_2026 where state = $1 order by ${collate('city')}`, [s])))

// votes per 10-minute bucket; bucket index shifted by 6 per hour to Brasilia time when `brt` (tz is the city's offset estimate)
const shift = (b) => (b ? '(ord - 1) - 6 * tz' : '(ord - 1)')
const curve = useAsync(() => [args.value, brt.value, base.loading], async ([a, b], q) => {
  if (waiting()) return null
  const found = isSection.value
    ? await rows(q, `select ${shift(b)} bucket, sum(v)::int votes from vt_2026 s join vtc_2026 using (state, city), unnest(s.b) with ordinality t(v, ord)
        where state = $1 and city = $2 and zone = $3 and section = $4 group by 1 order by 1`, a)
    : await rows(q, `select ${shift(b)} bucket, sum(v)::int votes from vtc_2026, unnest(b) with ordinality t(v, ord)
        where ($1::text is null or state = $1) and ($2::text is null or city = $2) group by 1 order by 1`, [a[0] ?? null, a[1] ?? null])
  const first = found.find((r) => r.votes > 0)?.bucket ?? 0
  const last = found.findLast((r) => r.votes > 0)?.bucket ?? 0
  const votes = Array.from({ length: last - first + 1 }, (_, i) => found.find((r) => r.bucket === first + i)?.votes ?? 0)
  const labels = votes.map((_, i) => clock(BUCKET.start + (first + i) * BUCKET.step))
  return { votes, labels, total: votes.reduce((t, v) => t + v, 0) }
})

const summary = useAsync(() => [args.value, base.loading], async ([a], q) => {
  if (waiting()) return null
  const [r] = await rows(q, `select count(*) cities, sum(sections) sections, sum(n) votes, min(tz) tz_min, max(tz) tz_max from vtc_2026
    where ($1::text is null or state = $1) and ($2::text is null or city = $2)`, [a[0] ?? null, a[1] ?? null])
  return r
})

const RANKS = {
  fast: ['Votação mais rápida (menor p10 do intervalo entre votos)', 'p10 asc', 'n >= 60'],
  regular: ['Ritmo regular demais ((p90 − p10) / mediana)', '(p90 - p10)::float8 / nullif(med, 0) asc', 'n >= 60 and med > 0'],
  gap: ['Maior pausa entre dois votos', 'maxgap desc', 'n >= 30'],
  diff: ['Eventos de voto × cédulas de presidente apuradas', 'abs(n - total) desc', 'total is not null'],
}
const paced = useAsync(() => [state.value, city.value, rank.value, base.loading], async ([s, c, r], q) => {
  if (waiting()) return null
  const [, order, where] = RANKS[r]
  return rows(q, `with t as (select v.*, s.nominal + s.blank + s.nul total from vt_2026 v left join sec_2026 s
      on s.state = v.state and s.city = v.city and s.zone = v.zone and s.section = v.section and s.model = v.model and s.office = 1
      where ($1::text is null or v.state = $1) and ($2::text is null or v.city = $2))
    select state, city, zone, section, n, total, n - total diff, first, last, p10, med, p90, maxgap from t where ${where} order by ${order} limit 20`, [s, c])
})

const go2 = (a) => go(href(year.value, 'time', a, { clock: brt.value ? null : 'local' }))
const pickState = (e) => go2(e.target.value ? [e.target.value] : [])
const pickCity = (e) => go2(e.target.value ? [state.value, e.target.value] : [state.value])
const pick = (key) => (e) => setParam(key, e.target.value)
const secLink = (r) => href(year.value, 'time', [r.state, r.city, r.zone, r.section], { clock: brt.value ? null : 'local' })
const sec = (v) => (v == null ? '–' : `${int(v)} s`)
const cols = computed(() => [
  { key: 'state', label: 'UF', fmt: (v) => v.toUpperCase() },
  { key: 'city', label: 'Município' },
  { key: 'zone', label: 'Zona' },
  { key: 'section', label: 'Seção', href: secLink },
  { key: 'n', label: 'Eventos', num: true, fmt: int },
  { key: 'total', label: 'Cédulas', num: true, fmt: int },
  { key: 'first', label: 'Primeiro', num: true, fmt: clock },
  { key: 'last', label: 'Último', num: true, fmt: clock },
  { key: 'p10', label: 'p10', num: true, fmt: sec },
  { key: 'med', label: 'Mediana', num: true, fmt: sec },
  { key: 'p90', label: 'p90', num: true, fmt: sec },
  { key: 'maxgap', label: 'Maior pausa', num: true, fmt: sec },
])
const title = computed(() => (isSection.value ? `Seção ${args.value[3]} · zona ${args.value[2]} · ${args.value[1]}/${args.value[0].toUpperCase()}` : city.value ? `${city.value}/${state.value.toUpperCase()}` : state.value ? STATE_NAMES[state.value] : 'Brasil'))
</script>

<template lang="pug">
h1 Horários de votação · {{ title }}
.controls(v-if="year === '2026'")
  label
    | UF
    select(:value="state ?? ''" @change="pickState")
      option(value="") Brasil
      option(v-for="s in parts('vt_2026')" :key="s" :value="s" :selected="s === state") {{ s.toUpperCase() }} · {{ STATE_NAMES[s] }}
  label(v-if="state && cities.data")
    | Município
    select(:value="city ?? ''" @change="pickCity")
      option(value="") todos
      option(v-for="c in cities.data" :key="c.city" :value="c.city" :selected="c.city === city") {{ c.city }}
  label
    | Relógio
    select(:value="brt ? 'brt' : 'local'" @change="setParam('clock', $event.target.value === 'brt' ? null : 'local')")
      option(value="brt") Brasília (UTC-3)
      option(value="local") local, como gravado
  a(v-if="isSection" :href="href(year, 'drill', args)") resultados da seção →
.muted(v-if="year !== '2026'") O dump de 2022 não tem horários de votação; escolha 2026.
.grid(v-else)
  Panel(title="Votos a cada 10 minutos (post Presidente: um evento por eleitor)" :state="curve" :election="year" wide)
    ColumnChart(:values="curve.data.votes" :labels="curve.data.labels" :height="260" :tick="int" :fmt="(v) => int(v) + ' votos'")
    p.muted(v-if="summary.data") {{ int(curve.data.total) }} eventos em {{ int(summary.data.sections) }} seções ({{ int(summary.data.cities) }} municípios) ·
      | relógio {{ brt ? 'convertido para Brasília com o fuso estimado por município (mín. ' + summary.data.tz_min + 'h, máx. ' + summary.data.tz_max + 'h)' : 'local como gravado pelo scraper' }}
  Panel(title="Ritmo por seção" :state="paced" :election="year" wide)
    .controls
      label
        | Ordenar por
        select(:value="rank" @change="pick('rank')")
          option(v-for="(r, k) in RANKS" :key="k" :value="k" :selected="k === rank") {{ r[0] }}
    p.muted Estatísticas por seção a partir dos intervalos entre votos (a mediana de uma votação normal fica perto de 100 s). Só entram UFs carregadas: escolha uma UF.
    DataTable(:columns="cols" :rows="paced.data")
</template>
