<script setup vapor>
import { computed, nextTick, onMounted, onUnmounted } from 'vue'
import { route, href, go, setParam } from '../router'
import { ELECTIONS, inElection } from '../model'
import { electionLabel, officeName, stateName, stateOptions, stateTitle } from '../labels'
import { t } from '../i18n'
import { partyColor } from '../colors'
import { loadGeo, preloadState } from '../geo'
import { candName, ensureRollups, residualOn, rollup, margin, quantile, stateWinners, titleCase, top, unitPlace, unitSql, unitTip, unitsOf, winnerFills, winnerLegend, winnersHeadline } from '../results'
import { useAsync } from '../use'
import { objects } from '../db'
import { int, pct } from '../format'
import Panel from '../components/Panel.vue'
import Field from '../components/Field.vue'
import Breadcrumb from '../components/Breadcrumb.vue'
import Chip from '../components/Chip.vue'
import SourceBadge from '../components/SourceBadge.vue'
import Legend from '../components/Legend.vue'
import ResidualSwitch from '../components/ResidualSwitch.vue'
import GeoMap from '../components/GeoMap.vue'
import ColumnChart from '../components/ColumnChart.vue'
import Scatter from '../components/Scatter.vue'

const year = computed(() => route.value.election)
const params = computed(() => route.value.params)
const scope = computed(() => params.value.get('scope') ?? 'uf') // uf | mun | state
const uf = computed(() => params.value.get('uf') ?? 'sp')
const office = computed(() => Number(params.value.get('office') ?? 1))
const metric = computed(() => params.value.get('metric') ?? 'winner')
const offices = computed(() => ELECTIONS[year.value].offices.filter((id) => [1, 3, 5].includes(id)))
const pick = (key, e) => setParam(key, e.target.value)

const base = useAsync(() => [year.value], async ([y]) => { await ensureRollups(y); return true })

const rateSql = (y, grain) => (grain === 'uf'
  ? `select state id, sum(blank) blank, sum(nul) nul, sum(nominal) nominal from ${rollup(y).tot} where office = $1 and ${inElection(y)} and state <> 'zz' group by 1`
  : `select m.ibge id, sum(t.blank) blank, sum(t.nul) nul, sum(t.nominal) nominal from ${rollup(y).tot} t join mun_map m on m.state = t.state and m.city = t.city
     where t.office = $1 and ${inElection(y, 't')} and ($2::text = '' or t.state = $2) group by 1`)

const grain = computed(() => (scope.value === 'uf' ? 'uf' : 'mun'))
const geoKind = computed(() => ({ uf: 'uf', mun: 'mun', state: uf.value })[scope.value])

const data = useAsync(() => [year.value, grain.value, scope.value === 'state' ? uf.value : '', office.value, params.value.get('cand') ?? '', base.loading, residualOn.value], async ([y, g, s, o, cand], q) => {
  if (base.loading) return null
  const args = g === 'uf' ? [o, cand] : [o, s, cand]
  const [rows, rates, map, overlay, winners] = await Promise.all([
    q(unitSql(y, g), args), ELECTIONS[y].hasBlank ? q(rateSql(y, g), g === 'uf' ? [o] : [o, s]) : null, loadGeo(geoKind.value), scope.value === 'mun' ? loadGeo('uf') : null, stateWinners(q, y, o),
  ])
  const units = unitsOf(rows)
  for (const r of rates ? objects(rates) : []) Object.assign(units.get(r.id) ?? {}, { rate: (r.blank + r.nul) / (r.nominal + r.blank + r.nul) })
  return { units, map, overlay, winners, grain: g } // the grain travels with the data: the view may still show the previous result while the next loads
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
const sequential = { margin: 'var(--seq-margin)', blank: 'var(--seq-blank)' }

const style = computed(() => {
  const us = [...data.data.units.values()]
  const m = metric.value
  if (m === 'winner') return { fills: winnerFills(data.data.units), range: [0, 0], color: null }
  const value = { share: shareOf, margin, blank: (u) => u.rate ?? 0 }[m]
  const vs = us.map(value)
  const [lo, hi] = [quantile(vs, 0.02), quantile(vs, 0.98)]
  const color = m === 'share' ? partyColor(leaders.value.find((l) => l.cand === shareCand.value)?.party ?? '') : sequential[m]
  return { fills: Object.fromEntries(us.map((u) => [u.id, [color, scale(value(u), lo, hi)]])), range: [lo, hi], color }
})

const tip = (id) => {
  const u = data.data.units.get(id)
  const extra = [...(u.rate != null ? [t('maps.blankAndNull', { rate: pct(u.rate, 1) })] : []), ...(data.data.grain === 'uf' ? [t('maps.clickCities')] : [])]
  return unitTip(u, data.data.grain, extra)
}
// the UF map opens a state's cities in place (keeping metric, office and candidate); a municipality opens its drill-down
const here = (changes) => href(year.value, 'maps', [], { ...Object.fromEntries(params.value), ...changes })
const focusPanel = () => nextTick(() => requestAnimationFrame(() => document.querySelector('.panel h2')?.focus({ preventScroll: true })))
const open = (id) => {
  if (data.data.grain === 'uf') { go(here({ scope: 'state', uf: id })); return focusPanel() }
  const u = data.data.units.get(id)
  go(href(year.value, 'drill', [u.state, u.name], { office: office.value }))
}
const toBrazil = () => { go(here({ scope: 'uf', uf: null })); focusPanel() }
// the municipality maps have thousands of shapes: keyboard users pick a place from this list instead
const places = computed(() => [...data.data.units.values()].map((u) => ({ id: u.id, label: unitPlace(u, 'mun') })).sort((a, b) => a.label.localeCompare(b.label)))
// a municipality without a polygon in the IBGE mesh (e.g. created after it) is still in the data: say so instead of hiding it
const noShape = computed(() => {
  const shapes = new Set(data.data.map.items.map(([id]) => String(id)))
  return [...data.data.units.values()].filter((u) => !shapes.has(String(u.id))).map((u) => unitPlace(u, 'mun'))
})
const find = (e) => { const place = places.value.find((p) => p.label === e.target.value); if (place) open(place.id) }
const onKey = (e) => e.key === 'Escape' && scope.value === 'state' && toBrazil()
onMounted(() => addEventListener('keydown', onKey))
onUnmounted(() => removeEventListener('keydown', onKey))

const legend = computed(() => winnerLegend(data.data.units, office.value))
const headline = computed(() => (year.value && data.data ? winnersHeadline(data.data.winners, office.value) : ''))
const abroad = computed(() => data.data?.winners.find((r) => r.state === 'zz' && r.rn === 1))
const gradient = computed(() => `linear-gradient(90deg, color-mix(in oklab, ${style.value.color} 15%, var(--map-blend-base)), ${style.value.color})`)
const legendItems = computed(() => [
  ...(metric.value === 'winner' ? legend.value.map((l) => ({ color: partyColor(l.party), label: `${l.label} · ${l.n}` })) : []),
  ...(abroad.value ? [{ color: partyColor(abroad.value.party), label: t('maps.abroad', { name: titleCase(abroad.value.name ?? abroad.value.cand), share: pct(abroad.value.votes / abroad.value.valid, 1) }) }] : []),
])

// how divided is the country? signed margin between the two national leaders in every municipality (president)
const BINS = 20
const spread = useAsync(() => [year.value, base.loading, residualOn.value], async ([y], q) => {
  if (base.loading) return null
  const rows = objects(await q(`with t as (select cand, sum(votes) v from ${rollup(y).res} where office = 1 and ${inElection(y)} and state <> 'zz' group by 1 order by 2 desc limit 2),
    a as (select cand from t order by v desc limit 1), b as (select cand from t order by v limit 1)
    select sum(r.votes) valid, (sum(r.votes) filter (where r.cand = (select cand from a)) - sum(r.votes) filter (where r.cand = (select cand from b)))::float8 / sum(r.votes) margin,
      (select short_name from cands where election = ${ELECTIONS[y].year} and turn = ${ELECTIONS[y].turn} and office = 1 and uf = 'br' and n = (select cand from a)) na, (select short_name from cands where election = ${ELECTIONS[y].year} and turn = ${ELECTIONS[y].turn} and office = 1 and uf = 'br' and n = (select cand from b)) nb
    from ${rollup(y).res} r join mun_map m on m.state = r.state and m.city = r.city where r.office = 1 and ${inElection(y, 'r')} and r.state <> 'zz' group by m.ibge having sum(r.votes) > 0`))
  const counts = Array(BINS).fill(0)
  for (const r of rows) counts[Math.min(Math.floor(((r.margin + 1) / 2) * BINS), BINS - 1)]++
  return { counts, points: rows.map((r) => [Math.log10(r.valid), r.margin]), a: titleCase(rows[0].na), b: titleCase(rows[0].nb) }
})
const binLabels = Array.from({ length: BINS }, (_, i) => `${Math.round(-100 + (i * 200) / BINS)}`)
const ufs = computed(() => stateOptions())
const panelTitle = computed(() => (scope.value === 'state' ? t('maps.panelState', { state: stateName(uf.value) }) : t(scope.value === 'uf' ? 'maps.panelUf' : 'maps.panelMun')))
const metricName = computed(() => t(`maps.metric.${metric.value}`))
</script>

<template lang="pug">
h1 {{ t('maps.title', { election: electionLabel(year) }) }}
SourceBadge(:election="year")
.cluster
  ResidualSwitch(v-if="ELECTIONS[year].hasResidual")
  Field(:label="t('maps.scale')")
    select(@change="pick('scope', $event)")
      option(value="uf" :selected="scope === 'uf'") {{ t('maps.scaleUf') }}
      option(value="mun" :selected="scope === 'mun'") {{ t('maps.scaleMun') }}
      option(value="state" :selected="scope === 'state'") {{ t('maps.scaleState') }}
  Field(v-if="scope === 'state'" :label="t('common.state')")
    select(@change="pick('uf', $event)")
      option(v-for="[s, title] in ufs" :key="s" :value="s" :selected="s === uf") {{ title }}
  Field(v-if="offices.length > 1" :label="t('common.office')")
    select(@change="pick('office', $event)")
      option(v-for="id in offices" :key="id" :value="id" :selected="id === office") {{ officeName(id) }}
  Field(:label="t('maps.show')")
    select(@change="pick('metric', $event)")
      option(value="winner" :selected="metric === 'winner'") {{ t('maps.metric.winner') }}
      option(value="share" :selected="metric === 'share'") {{ t('maps.metric.share') }}
      option(value="margin" :selected="metric === 'margin'") {{ t('maps.metric.margin') }}
      option(value="blank" :selected="metric === 'blank'" :disabled="!ELECTIONS[year].hasBlank") {{ t('maps.metric.blank') }}
  Field(v-if="data.data && data.data.grain === 'mun'" :label="t('maps.findCity')")
    input(list="map-places" :placeholder="t('maps.findCityHint')" @change="find($event)")
    datalist#map-places
      option(v-for="p in places" :key="p.id" :value="p.label")
  Field(v-if="metric === 'share' && data.data" :label="t('maps.candidate')")
    select(@change="pick('cand', $event)")
      option(v-for="l in leaders" :key="l.cand" :value="l.cand" :selected="l.cand === shareCand") {{ candName(l) }}
p.headline(v-if="headline") {{ t('maps.headline', { office: officeName(office), headline }) }}
.grid-auto
  Panel(:title="panelTitle" :state="data" :election="year" wide)
    Breadcrumb(v-if="scope === 'state'" :items="[{ label: t('common.brazil'), href: here({ scope: 'uf', uf: null }) }, { label: stateTitle(uf) }]" :label="t('maps.mapNav')")
      template(#end)
        a(:href="href(year, 'drill', [uf], { office })") {{ t('maps.seeDetail') }}
    .mapwrap(:class="{ 'mapwrap--busy': data.loading }")
      GeoMap(:map="data.data.map" :overlay="data.data.overlay" :fills="style.fills" :tip="tip" :keyboard="data.data.grain === 'uf'" :label="t('maps.mapLabel', { metric: metricName })" @pick="open" @hover="data.data.grain === 'uf' && preloadState($event)")
    Legend(:items="legendItems")
      span.muted(v-if="metric === 'winner'") {{ t('maps.strongerMargin') }}
      template(v-else)
        span.muted {{ pct(style.range[0], 0) }}
        i.legend__ramp(:style="{ background: gradient }")
        span.muted {{ pct(style.range[1], 0) }}
        span.muted(v-if="metric === 'share'") {{ t('maps.shareOf', { name: candName(leaders.find((l) => l.cand === shareCand)) }) }}
    details.statelinks(v-if="scope === 'uf'")
      summary {{ t('maps.openStateTable') }}
      .chips
        Chip(v-for="[s] in ufs" :key="s" :href="href(year, 'drill', [s], { office })") {{ s.toUpperCase() }}
    p.muted {{ t('maps.note') }}
    p.muted(v-if="data.data.grain === 'mun' && noShape.length") {{ t('maps.noShape', { names: noShape.join(', ') }) }}
  Panel(:title="t('maps.spreadTitle')" :state="spread" :election="year")
    ColumnChart(:label="t('maps.spreadTitle')" :values="spread.data.counts" :labels="binLabels" :tick="int" :fmt="(v) => t('maps.municipalities', { count: v })")
    p.muted {{ t('maps.spreadNote', { a: spread.data.a, b: spread.data.b }) }}
  Panel(:title="t('maps.sizeTitle')" :state="spread" :election="year")
    Scatter(:points="spread.data.points" :x-label="t('maps.sizeX')" :y-label="t('maps.sizeY')")
    p.muted {{ t('maps.sizeNote') }}
</template>
