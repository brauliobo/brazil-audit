<script setup vapor>
import { computed } from 'vue'
import { route, href, go, setParam } from '../router'
import { ELECTIONS, STATE_NAMES } from '../model'
import { partyColor } from '../colors'
import { loadGeo } from '../geo'
import { candName, ensureRollups, margin, quantile, stateWinners, titleCase, top, unitSql, unitsOf, winnersHeadline } from '../results'
import { useAsync } from '../use'
import { objects } from '../db'
import { int, pct } from '../format'
import Panel from '../components/Panel.vue'
import GeoMap from '../components/GeoMap.vue'
import ColumnChart from '../components/ColumnChart.vue'
import Scatter from '../components/Scatter.vue'

const year = computed(() => route.value.election)
const params = computed(() => route.value.params)
const scope = computed(() => params.value.get('scope') ?? 'uf') // uf | mun | state
const uf = computed(() => params.value.get('uf') ?? 'sp')
const office = computed(() => Number(params.value.get('office') ?? 1))
const metric = computed(() => params.value.get('metric') ?? 'winner')
const offices = computed(() => Object.entries(ELECTIONS[year.value].offices).filter(([id]) => [1, 3, 5].includes(+id)))
const pick = (key) => (e) => setParam(key, e.target.value)

const base = useAsync(() => [year.value], async ([y]) => { await ensureRollups(y); return true })

const rateSql = (y, grain) => (grain === 'uf'
  ? `select state id, sum(blank) blank, sum(nul) nul, sum(nominal) nominal from tot_${y} where office = $1 and state <> 'zz' group by 1`
  : `select m.ibge id, sum(t.blank) blank, sum(t.nul) nul, sum(t.nominal) nominal from tot_${y} t join mun_map m on m.state = t.state and m.city = t.city
     where t.office = $1 and ($2::text = '' or t.state = $2) group by 1`)

const grain = computed(() => (scope.value === 'uf' ? 'uf' : 'mun'))
const geoKind = computed(() => ({ uf: 'uf', mun: 'mun', state: uf.value })[scope.value])

const data = useAsync(() => [year.value, grain.value, scope.value === 'state' ? uf.value : '', office.value, params.value.get('cand') ?? '', base.loading], async ([y, g, s, o, cand], q) => {
  if (base.loading) return null
  const args = g === 'uf' ? [o, cand] : [o, s, cand]
  const [rows, rates, map, overlay, winners] = await Promise.all([
    q(unitSql(y, g), args), y === '2026' ? q(rateSql(y, g), g === 'uf' ? [o] : [o, s]) : null, loadGeo(geoKind.value), scope.value === 'mun' ? loadGeo('uf') : null, stateWinners(q, y),
  ])
  const units = unitsOf(rows)
  for (const r of rates ? objects(rates) : []) Object.assign(units.get(r.id) ?? {}, { rate: (r.blank + r.nul) / (r.nominal + r.blank + r.nul) })
  return { units, map, overlay, winners }
})

const scale = (v, lo, hi) => 0.15 + 0.85 * Math.min(Math.max((v - lo) / ((hi - lo) || 1), 0), 1)

// the candidate list for the share metric: leaders of the whole selection
const leaders = computed(() => {
  const tally = new Map()
  for (const u of data.data.units.values()) { const w = top(u, 1); tally.set(w.cand, { ...w, wins: (tally.get(w.cand)?.wins ?? 0) + 1 }) }
  return [...tally.values()].sort((a, b) => b.wins - a.wins)
})
const shareCand = computed(() => params.value.get('cand') || leaders.value[0]?.cand)
const shareOf = (u) => (u.list.find((r) => r.cand === shareCand.value)?.votes ?? 0) / u.valid
const sequential = { margin: '#3b6de0', blank: '#e07a1f' }

const style = computed(() => {
  const us = [...data.data.units.values()]
  const m = metric.value
  if (m === 'winner') {
    const hi = quantile(us.map(margin), 0.9)
    return { fill: (u) => [partyColor(top(u, 1).party), 0.4 + 0.6 * Math.min(margin(u) / (hi || 1), 1)], range: [0, hi], color: null }
  }
  const value = { share: shareOf, margin, blank: (u) => u.rate ?? 0 }[m]
  const vs = us.map(value)
  const [lo, hi] = [quantile(vs, 0.02), quantile(vs, 0.98)]
  const color = m === 'share' ? partyColor(leaders.value.find((l) => l.cand === shareCand.value)?.party ?? '') : sequential[m]
  return { fill: (u) => [color, scale(value(u), lo, hi)], range: [lo, hi], color }
})

const fills = computed(() => Object.fromEntries([...data.data.units].map(([id, u]) => [id, style.value.fill(u)])))
const tip = (id) => {
  const u = data.data.units.get(id)
  if (!u) return id
  const line = (r) => `${candName(r)}: ${int(r.votes)} (${pct(r.votes / u.valid, 1)})`
  const rate = u.rate != null ? [`Brancos e nulos: ${pct(u.rate, 1)}`] : []
  const place = scope.value === 'uf' ? `${id.toUpperCase()} · ${STATE_NAMES[id]}` : `${titleCase(u.name)} (${u.state.toUpperCase()})`
  return [place, ...u.list.filter((r) => r.rn <= 3).map(line), `Vencedor: ${candName(top(u, 1))}`, ...rate].join('\n')
}
const open = (id) => {
  const u = data.data.units.get(id)
  go(scope.value === 'uf' ? href(year.value, 'drill', [id], { office: office.value }) : href(year.value, 'drill', [u.state, u.name], { office: office.value }))
}

const legend = computed(() => {
  const tally = Object.entries(Object.groupBy([...data.data.units.values()], (u) => top(u, 1).party ?? '–')).map(([party, l]) => ({ party, n: l.length, name: candName(top(l[0], 1)) })).sort((a, b) => b.n - a.n)
  return tally.slice(0, 8)
})
const headline = computed(() => (year.value && data.data ? winnersHeadline(data.data.winners) : ''))
const abroad = computed(() => data.data.winners.find((r) => r.state === 'zz' && r.rn === 1))
const gradient = computed(() => `linear-gradient(90deg, color-mix(in srgb, ${style.value.color ?? '#888'} 15%, transparent), ${style.value.color ?? '#888'})`)

// how divided is the country? signed margin between the two national leaders in every municipality (president)
const BINS = 20
const spread = useAsync(() => [year.value, base.loading], async ([y], q) => {
  if (base.loading) return null
  const rows = objects(await q(`with t as (select cand, sum(votes) v from res_${y} where office = 1 and state <> 'zz' group by 1 order by 2 desc limit 2),
    a as (select cand from t order by v desc limit 1), b as (select cand from t order by v limit 1)
    select sum(r.votes) valid, (sum(r.votes) filter (where r.cand = (select cand from a)) - sum(r.votes) filter (where r.cand = (select cand from b)))::float8 / sum(r.votes) margin,
      (select short_name from cands where election = ${y} and office = 1 and uf = 'br' and n = (select cand from a)) na, (select short_name from cands where election = ${y} and office = 1 and uf = 'br' and n = (select cand from b)) nb
    from res_${y} r join mun_map m on m.state = r.state and m.city = r.city where r.office = 1 and r.state <> 'zz' group by m.ibge having sum(r.votes) > 0`))
  const counts = Array(BINS).fill(0)
  for (const r of rows) counts[Math.min(Math.floor(((r.margin + 1) / 2) * BINS), BINS - 1)]++
  return { counts, points: rows.map((r) => [Math.log10(r.valid), r.margin]), a: titleCase(rows[0].na), b: titleCase(rows[0].nb) }
})
const binLabels = Array.from({ length: BINS }, (_, i) => `${Math.round(-100 + (i * 200) / BINS)}`)
const ufs = Object.entries(STATE_NAMES).filter(([s]) => s !== 'zz')
</script>

<template lang="pug">
h1 Mapas · {{ ELECTIONS[year].label }}
.controls
  label
    | Escala
    select(@change="pick('scope')")
      option(value="uf" :selected="scope === 'uf'") Brasil por UF
      option(value="mun" :selected="scope === 'mun'") Brasil por município
      option(value="state" :selected="scope === 'state'") Uma UF por município
  label(v-if="scope === 'state'")
    | UF
    select(@change="pick('uf')")
      option(v-for="[s, name] in ufs" :key="s" :value="s" :selected="s === uf") {{ s.toUpperCase() }} · {{ name }}
  label(v-if="offices.length > 1")
    | Cargo
    select(@change="pick('office')")
      option(v-for="[id, name] in offices" :key="id" :value="id" :selected="Number(id) === office") {{ name }}
  label
    | Mostrar
    select(@change="pick('metric')")
      option(value="winner" :selected="metric === 'winner'") Quem venceu
      option(value="share" :selected="metric === 'share'") % de um candidato
      option(value="margin" :selected="metric === 'margin'") Margem da vitória
      option(value="blank" :selected="metric === 'blank'" :disabled="year === '2022'") Brancos + nulos
  label(v-if="metric === 'share' && data.data")
    | Candidato
    select(@change="pick('cand')")
      option(v-for="l in leaders" :key="l.cand" :value="l.cand" :selected="l.cand === shareCand") {{ candName(l) }}
p.headline(v-if="headline") Presidente: {{ headline }}
.grid
  Panel(:title="scope === 'uf' ? 'Brasil por UF' : scope === 'mun' ? 'Brasil por município' : `${STATE_NAMES[uf]} por município`" :state="data" :election="year" wide)
    GeoMap(:map="data.data.map" :overlay="data.data.overlay" :fills="fills" :tip="tip" :keyboard="scope === 'uf'" :label="`Mapa colorido por ${metric}`" @pick="open")
    .legend-row
      template(v-if="metric === 'winner'")
        span.key(v-for="l in legend" :key="l.party")
          i.sw(:style="{ background: partyColor(l.party) }")
          | {{ office === 1 ? l.name : l.party }} · {{ l.n }}
        span.muted cor mais forte = maior margem
      template(v-else)
        span.muted {{ pct(style.range[0], 0) }}
        i.ramp(:style="{ background: gradient }")
        span.muted {{ pct(style.range[1], 0) }}
        span.muted(v-if="metric === 'share'") % de {{ candName(leaders.find((l) => l.cand === shareCand)) }}
      span.key(v-if="abroad")
        i.sw(:style="{ background: partyColor(abroad.party) }")
        | Exterior: {{ titleCase(abroad.name ?? abroad.cand) }} {{ pct(abroad.votes / abroad.valid, 1) }}
    p.muted Fonte: TSE, IBGE. Passe o mouse (ou use Tab nas UFs) para ver os votos; clique para abrir o detalhamento. Fernando de Noronha e as ilhas oceânicas ficam fora do desenho.
  Panel(title="Margem entre os dois mais votados, por município" :state="spread" :election="year")
    ColumnChart(:values="spread.data.counts" :labels="binLabels" :tick="int" :fmt="(v) => int(v) + ' municípios'")
    p.muted Municípios por faixa de margem em pontos percentuais: valores negativos = {{ spread.data.b }} na frente, positivos = {{ spread.data.a }} na frente.
  Panel(title="Tamanho do município × margem" :state="spread" :election="year")
    Scatter(:points="spread.data.points" x-label="log10 dos votos nominais" y-label="margem")
    p.muted Cada ponto é um município: os pequenos variam muito, os grandes ficam perto do centro.
</template>
