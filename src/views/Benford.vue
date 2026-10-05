<script setup vapor>
import { computed } from 'vue'
import { route, href, go, setParam } from '../router'
import { electionLabel, stateTitle } from '../labels'
import { ensure, store } from '../data'
import { loadGeo } from '../geo'
import { useAsync } from '../use'
import { objects } from '../db'
import ButtonGroup from '../components/ButtonGroup.vue'
import Field from '../components/Field.vue'
import Notice from '../components/Notice.vue'
import SourceBadge from '../components/SourceBadge.vue'
import Panel from '../components/Panel.vue'
import Chart from '../benford/Chart.vue'
import Controls from '../benford/Controls.vue'
import DigitTable from '../benford/DigitTable.vue'
import Explainer from '../benford/Explainer.vue'
import Heatmap from '../benford/Heatmap.vue'
import Multiples from '../benford/Multiples.vue'
import PlaceMap from '../benford/PlaceMap.vue'
import Ranking from '../benford/Ranking.vue'
import Stats from '../benford/Stats.vue'
import { analyze } from '../benford/analysis'
import * as data from '../benford/data'
import { GRAIN, HEAT as HEAT_TEXT, METRIC, POSITION, UNIT } from '../benford/keys'
import { GRAINS, HEAT, MAP_METRICS, params } from '../benford/params'
import { minSample } from '../benford/stats'
import { t } from '../i18n'

import '../benford/benford.css'

const p = params
const query = computed(() => Object.fromEntries(route.value.params))
const here = (changes) => href(p.value.election, 'benford', [], { ...query.value, ...changes })
const placeLabel = ({ uf, city }) => (uf === 'br' ? t('common.brazil') : city ? `${city} (${uf.toUpperCase()})` : stateTitle(uf))

// everything below waits for the parts of the place (national part, plus the UF's own part) and re-runs when they arrive
const loaded = useAsync(() => [p.value.election, p.value.uf], async ([e, uf]) => { await data.ensureScope(e, uf); return true })
const scope = (extra = []) => [p.value.election, p.value.office, p.value.unit, p.value.uf, p.value.city, p.value.pos, loaded.loading, ...extra]
const gated = (fn) => async (d, q) => (loaded.loading ? null : fn(d, q))

const labels = useAsync(() => [p.value.election, p.value.office, p.value.uf, loaded.loading], gated(async (_, q) => data.labelsOf(await q(...data.labelsQuery(p.value)))))
const candList = useAsync(() => scope(), gated(async (_, q) => objects(await q(...data.candsQuery(p.value)))))
const options = computed(() => {
  if (!candList.data || !labels.data) return []
  return candList.data.map((r) => ({ cand: r.cand, n: r.n, group: data.candGroup(r.cand), label: data.candLabel(r.cand, p.value, labels.data) }))
    .toSorted((a, b) => data.GROUPS.indexOf(a.group) - data.GROUPS.indexOf(b.group))
})
const cand = computed(() => (options.value.some((o) => o.cand === p.value.cand) ? p.value.cand : options.value[0]?.cand ?? null))
const eff = computed(() => ({ ...p.value, cand: cand.value }))
const candLabel = computed(() => options.value.find((o) => o.cand === cand.value)?.label ?? '')
const cities = useAsync(() => [p.value.election, p.value.office, p.value.uf, cand.value, loaded.loading], gated(async (_, q) => (cand.value && p.value.uf !== 'br' ? objects(await q(...data.citiesQuery(eff.value))).map((r) => r.city) : [])))

// every result carries the position it was queried for: while a new query runs the old data stays on screen with its own digits
const main = useAsync(() => scope([cand.value]), gated(async (_, q) => {
  const ctx = eff.value
  if (!ctx.cand) return { empty: true }
  const [digits, stat] = await Promise.all([q(...data.digitsQuery(ctx)), q(...data.statQuery(ctx))])
  const rows = objects(digits)
  return rows.length ? { ...data.scopeOf(ctx.pos, rows), pos: ctx.pos, stat: data.statOf(objects(stat)) } : { empty: true }
}))
const result = computed(() => (main.data && !main.data.empty ? analyze(main.data.pos, main.data.counts, main.data.base, main.data.stat, p.value.minn) : null))
const title = computed(() => t('benford.chart.title', { cand: candLabel.value, unit: t(UNIT[p.value.unit].label), place: placeLabel(p.value), pos: t(POSITION[p.value.pos]) }))

const multiples = useAsync(() => scope([cand.value]), gated(async (_, q) => {
  const ctx = p.value
  const [digits, stats] = (await Promise.all(data.multiplesQueries(ctx).map((x) => q(...x)))).map(objects)
  const mad = new Map(stats.map((r) => [r.cand, { mad: { mean: r.mean, lo: r.lo, hi: r.hi } }]))
  return [...Map.groupBy(digits, (r) => r.cand)].map(([c, rows]) => ({ cand: c, pos: ctx.pos, ...data.scopeOf(ctx.pos, rows), stat: mad.get(c) ?? null }))
}))
const items = computed(() => (multiples.data && labels.data
  ? multiples.data.map((m) => ({ cand: m.cand, label: data.candLabel(m.cand, p.value, labels.data), group: data.candGroup(m.cand), result: analyze(m.pos, m.counts, m.base, m.stat, p.value.minn) }))
    .toSorted((a, b) => data.GROUPS.indexOf(a.group) - data.GROUPS.indexOf(b.group) || b.result.n - a.result.n).slice(0, 30)
  : []))

const heatPos = computed(() => (p.value.pos === 'd12' ? 'd1' : p.value.pos))
const heat = useAsync(() => [p.value.election, p.value.office, heatPos.value, cand.value, loaded.loading], gated(async (_, q) => {
  const ctx = { ...eff.value, pos: heatPos.value }
  if (!ctx.cand) return []
  const [digits, stats] = (await Promise.all(data.heatQueries(ctx).map((x) => q(...x)))).map(objects)
  const mad = new Map(stats.map((r) => [r.uf, { mad: { mean: r.mean, lo: r.lo, hi: r.hi } }]))
  return [...Map.groupBy(digits, (r) => r.uf)].map(([uf, rows]) => ({ uf, pos: ctx.pos, scope: data.scopeOf(ctx.pos, rows), stat: mad.get(uf) ?? null }))
}))
const heatRows = computed(() => (heat.data ?? []).map((h) => ({ uf: h.uf, result: analyze(h.pos, h.scope.counts, h.scope.base, h.stat, p.value.minn) })))

// the map and the ranking read the section unit at the first or second digit (the places that carry municipality histograms)
const mapPos = computed(() => (p.value.pos === 'd2' ? 'd2' : 'd1'))
const mapMinN = computed(() => (p.value.minnGiven ? p.value.minn : minSample(mapPos.value)))
const grain = computed(() => (p.value.uf === 'br' ? p.value.grain : 'mun'))
const places = useAsync(() => [p.value.election, p.value.office, p.value.uf, grain.value, mapPos.value, mapMinN.value, cand.value, loaded.loading], gated(async (_, q) => {
  const [ctx, mun, minN] = [{ ...eff.value, pos: mapPos.value }, grain.value === 'mun', mapMinN.value]
  if (!ctx.cand || ctx.uf === 'zz') return { list: [], map: null } // the consular posts have no municipality geometry
  if (mun) await (ctx.uf === 'br' ? data.ensureAll(ctx.election) : ensure('mun_map'))
  const [ibge, map, overlay, queried] = await Promise.all([
    mun ? q(...data.munMapQuery()) : null,
    loadGeo(!mun ? 'uf' : ctx.uf === 'br' ? 'mun' : ctx.uf), mun && ctx.uf === 'br' ? loadGeo('uf') : null,
    Promise.all(data.placesQueries(ctx, mun ? 'mun' : 'uf').map((x) => q(...x))),
  ])
  const ids = new Map(ibge ? objects(ibge).map((r) => [`${r.state}|${r.city}`, r.ibge]) : [])
  return { list: data.placesOf(ctx.pos, queried, ids, minN), map, overlay }
}))
const open = (id) => {
  const place = places.data.list.find((x) => x.id === id)
  if (place) go(here({ place: place.city ? `${place.uf}/${place.city}` : place.uf }))
}

const build = computed(() => data.buildParams(store.manifest))
const grains = computed(() => GRAINS.map((g) => ({ value: g, label: t(GRAIN[g]), title: g === 'mun' ? t('benford.map.grainMunHint') : undefined })))
const sqls = computed(() => (cand.value ? [data.shippedSql(eff.value), data.rawSql(eff.value)] : []))
</script>

<template lang="pug">
h1 {{ t('benford.page.title', { election: electionLabel(p.election) }) }}
SourceBadge(:election="p.election")
p.bf-lede {{ t('benford.page.lede') }}
Notice(kind="warning")
  | {{ t('benford.page.caution') }}
  |
  a(href="#bf-explainer") {{ t('benford.page.explainerLink') }}
Controls(:p="eff" :cands="options" :cities="cities.data ?? []" :default-min-n="minSample(p.pos)")
.grid-auto
  Panel(:title="title" :state="main" :election="p.election" wide)
    .bf-main(v-if="result")
      Chart(:result="result" :title="title")
      Stats(:result="result")
    p(v-else) {{ t('benford.page.noData') }}
    details.panel__sql(v-if="sqls.length")
      summary {{ t('benford.sql.title') }}
      p.muted {{ t('benford.sql.shipped') }}
      pre {{ sqls[0] }}
      a(:href="href(p.election, 'sql', [], { q: sqls[0] })") {{ t('common.openInConsole') }}
      p.muted {{ t('benford.sql.raw') }}
      pre {{ sqls[1] }}
      a(:href="href(p.election, 'sql', [], { q: sqls[1] })") {{ t('common.openInConsole') }}
  Panel(v-if="result" :title="t('benford.table.title')" :state="main" :election="p.election" wide)
    DigitTable(:result="result")
  Panel(:title="t('benford.multiples.title')" :state="multiples" :election="p.election" wide)
    Multiples(:items="items" :link="(c) => here({ cand: c })")
  Panel(:title="t('benford.heatmap.title')" :state="heat" :election="p.election" wide)
    .cluster.bf-controls
      Field(:label="t('benford.controls.heat')")
        select(@change="setParam('heat', $event.target.value)")
          option(v-for="h in HEAT" :key="h" :value="h" :selected="p.heat === h" :title="t(HEAT_TEXT[h].hint)") {{ t(HEAT_TEXT[h].label) }}
    p.muted {{ t('benford.heatmap.note') }}
    Heatmap(:rows="heatRows" :metric="p.heat" :link="(uf) => here({ place: uf, unit: 'section' })")
  Panel(:title="t('benford.map.title')" :state="places" :election="p.election" wide)
    .cluster.bf-controls
      ButtonGroup(v-if="p.uf === 'br'" :label="t('benford.controls.grain')" :items="grains" :value="grain" @change="setParam('grain', $event)")
      Field(:label="t('benford.controls.mapMetric')")
        select(@change="setParam('metric', $event.target.value)")
          option(v-for="m in MAP_METRICS" :key="m" :value="m" :selected="p.metric === m") {{ t(METRIC[m]) }}
    p.muted {{ t('benford.map.notice', { min: mapMinN }) }}
    p(v-if="places.data && !places.data.map") {{ t('benford.map.noMap') }}
    PlaceMap(v-else-if="places.data" :places="places.data.list" :map="places.data.map" :overlay="places.data.overlay" :metric="p.metric" :keyboard="grain === 'uf'" @pick="open")
  Panel(v-if="places.data" :title="t('benford.ranking.title')" :state="places" :election="p.election" wide)
    Ranking(:places="places.data.list" :election="p.election" :office="p.office" :here="(place) => here({ place })")
  section#bf-explainer.panel.span-all
    header.panel__header
      h2 {{ t('benford.explainer.title') }}
    Explainer(:build="build")
</template>
