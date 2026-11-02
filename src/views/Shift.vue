<script setup vapor>
import { computed, reactive } from 'vue'
import { route, href, setParam, go } from '../router'
import { ELECTIONS } from '../model'
import { electionLabel, stateName, stateTitle } from '../labels'
import { partyColor } from '../colors'
import { t } from '../i18n'
import { ensure, ensureOffice, ensureScope, ensureSmall, ensureState, statesIn } from '../data'
import { useAsync } from '../use'
import { objects } from '../db'
import { int, pct, signed } from '../format'
import { childrenSql, citiesSql, estimateUnitsSql, finalistsSql, firstRoundOf, governorsSql, levelOf, linkedTo, pools, poolShare, rosterSql, shiftOf, totalOf, transfersOf, unitsSql } from '../shift'
import Panel from '../components/Panel.vue'
import Notice from '../components/Notice.vue'
import Tabs from '../components/Tabs.vue'
import Stat from '../components/Stat.vue'
import Legend from '../components/Legend.vue'
import Breadcrumb from '../components/Breadcrumb.vue'
import ButtonGroup from '../components/ButtonGroup.vue'
import DataTable from '../components/DataTable.vue'
import BarList from '../components/BarList.vue'
import Field from '../components/Field.vue'
import ColumnChart from '../components/ColumnChart.vue'

const TABS = ['votes', 'places', 'cases']
const CASES = ['turned', 'big', 'small']
const BIG = 80000 // the larger municipalities: at least this many votes for the finalists in the runoff
const TOP = 10
const SMALL = 20 // a finalist gained from 0 to this many votes

const year = computed(() => route.value.election)
const yr = computed(() => ELECTIONS[year.value].year) // the `election` column of the tables
const first = computed(() => firstRoundOf(year.value))
const args = computed(() => route.value.args)
const [state, city, zone] = [computed(() => args.value[0] ?? null), computed(() => args.value[1] ?? null), computed(() => args.value[2] ?? null)]
const level = computed(() => levelOf(args.value))
const CHILD = { country: 'state', state: 'city', zone: 'section', city: 'zone' }
const param = (name, allowed) => computed(() => (allowed.includes(route.value.params.get(name)) ? route.value.params.get(name) : allowed[0]))
const [tab, kase] = [param('tab', TABS), param('case', CASES)]
const keepTab = computed(() => (tab.value === TABS[0] ? {} : { tab: tab.value }))

// the rollups of every state and the sections of the state in view, for both rounds
const base = useAsync(() => [year.value, first.value, state.value, city.value, tab.value, kase.value], async ([y, f, s, c, tb, cs]) => {
  const both = [f, y]
  await Promise.all([ensure('cands'), ensure('spectrum'), ensure('endorsement'), ...both.flatMap((e) => [ensureSmall(e, 'sgz', 'residual'), ensureOffice('res', e, 1), ensureOffice('tot', e, 1)])])
  if (s && (c || (tb === 'cases' && cs === 'small'))) await Promise.all(both.flatMap((e) => [ensureScope('rdv', e, s), ...(c ? [ensureState('sg', e, s)] : [])]))
  return true
})
const use = (run) => useAsync(() => [yr.value, state.value, city.value, zone.value, String(route.value.params), base.loading, finalists.data], async ([y, s, c, z], q) =>
  base.loading || !finalists.data ? null : run(y, { s, c, z }, async ({ sql, params }) => objects(await q(sql, params))))

const finalists = useAsync(() => [yr.value, base.loading], async ([y], q) => (base.loading ? null : objects(await q(...Object.values(finalistsSql(y))))))
const [A, B] = [computed(() => finalists.data?.[0]), computed(() => finalists.data?.[1])]
const names = computed(() => ({ a: A.value?.name, b: B.value?.name }))
const numbers = () => [A.value.n, B.value.n]
const place = computed(() => (zone.value ? t('shift.zone', { zone: zone.value }) : city.value ?? (state.value ? stateName(state.value) : t('common.brazil'))))

const children = use(async (y, { s, c, z }, r) => {
  const rows = (await r(childrenSql([s, c, z].filter(Boolean), y, ...numbers()))).map(shiftOf)
  return { rows, total: totalOf(rows) }
})
const cities = use(async (y, _place, r) => (tab.value === 'cases' && kase.value !== 'small' ? (await r(citiesSql(y, ...numbers()))).map(shiftOf) : null))
const governors = use(async (y, _p, r) => {
  if (tab.value !== 'cases' || kase.value !== 'turned') return null
  await ensureOffice('res', first.value, 3)
  return new Map((await r(governorsSql(y))).map((g) => [`${g.state}/${g.city}`, g]))
})

// ---- Votos: where the voters of each first-round group went, estimated from how the places differ ----------------------------------
const estimation = use(async (y, { s, c, z }, r) => {
  if (tab.value !== 'votes') return null
  const q = estimateUnitsSql([s, c, z].filter(Boolean), y, ...numbers())
  const [roster, places, votes] = await Promise.all([r(rosterSql(y)), r(q.places), r(q.votes)])
  return transfersOf({ places, votes }, roster, ...numbers())
})
const SEGMENTS = [['a', 'var(--candidate-pt)'], ['b', 'var(--candidate-pl)'], ['blank', 'var(--candidate-other)'], ['abstention', 'var(--bar-track-bg)']] // i18n-ignore
const fills = Object.fromEntries(SEGMENTS)
const legend = computed(() => SEGMENTS.map(([id, fill]) => ({ color: fill, label: id === 'a' || id === 'b' ? names.value[id] : t(`shift.group.${id}`) })))
const groupName = (g) => (g.id === 'c' ? `${g.name} · ${g.party}` : g.id === 'a' || g.id === 'b' ? names.value[g.id] : t(`shift.group.${g.id}`))
const declaredName = (n) => (n === A.value?.n ? names.value.a : n === B.value?.n ? names.value.b : null)
const SHOWN = 0.001 // a candidate under this share of the first-round votes shares the row of the remaining candidates
const segmentsOf = (g) => SEGMENTS.map(([id], j) => ({ id, share: g.share[j], title: `${g.label} → ${id === 'a' || id === 'b' ? names.value[id] : t(`shift.group.${id}`)}: ${pct(g.share[j], 0)} (${pct(g.low[j], 0)}–${pct(g.high[j], 0)}) · ${int(g.to[j])}` }))
const merged = (rows) => {
  const votes = rows.reduce((n, g) => n + g.votes, 0)
  const by = (key) => rows[0].share.map((_, j) => (votes ? rows.reduce((n, g) => n + g[key][j] * g.votes, 0) / votes : 0))
  return { id: 'rest', votes, share: by('share'), low: by('low'), high: by('high'), to: rows[0].to.map((_, j) => rows.reduce((n, g) => n + g.to[j], 0)) }
}
const flowRows = computed(() => {
  const rows = estimation.data?.rows ?? []
  const total = rows.reduce((n, g) => n + (g.id === 'blank' || g.id === 'abstention' ? 0 : g.votes), 0)
  const small = rows.filter((g) => g.id === 'rest' || (g.id === 'c' && g.votes < SHOWN * total))
  const kept = rows.filter((g) => !small.includes(g))
  const shown = [...kept.slice(0, kept.findIndex((g) => g.id === 'blank')), merged(small), ...kept.slice(kept.findIndex((g) => g.id === 'blank'))]
  return shown.map((g) => ({ ...g, label: groupName(g), support: declaredName(g.declared) })).map((g) => ({ ...g, segments: segmentsOf(g) }))
})
const fitNote = computed(() => t('shift.fit', { places: int(estimation.data.places), unit: t(`shift.unit.${level.value === 'zone' || level.value === 'city' ? 'section' : 'city'}`), fit: pct(estimation.data.fit, 0) }))
const headline = computed(() => {
  const s = children.data?.total
  return s ? [[signed(s.d.a), t('shift.col.delta', { name: names.value.a })], [signed(s.d.b), t('shift.col.delta', { name: names.value.b })], [int(s.others1), t('shift.col.others')]] : []
})
const supportRows = computed(() => (estimation.data?.declared ?? []).map((d, k) => ({ ...d, name: names.value[k ? 'b' : 'a'], gain: children.data?.total.d[k ? 'b' : 'a'], rate: d.declared ? d.followed / d.declared : null })).filter((d) => d.declared))
const supportCols = computed(() => [
  { key: 'name', label: t('shift.support.finalist') }, { key: 'gain', label: t('shift.support.gain'), num: true, fmt: (v) => signed(v) },
  { key: 'declared', label: t('shift.support.declared'), num: true, fmt: int }, { key: 'followed', label: t('shift.support.followed'), num: true, fmt: int },
  { key: 'rate', label: t('shift.support.rate'), num: true, fmt: (v) => pct(v, 0) },
])
const poolRows = computed(() => (children.data ? pools(children.data.total).map((p) => ({ ...p, share: poolShare(p.value, children.data.total) })) : []))
const poolCols = computed(() => [
  { key: 'id', label: t('shift.pool.source'), fmt: (v) => t(`shift.pool.${v}`) }, { key: 'value', label: t('shift.pool.votes'), num: true, fmt: (v) => signed(v) },
  { key: 'share', label: t('shift.pool.share'), num: true, fmt: (v) => (v == null ? '–' : pct(v, 1)) },
])
const gapNote = computed(() => (children.data?.rows.some((r) => r.gap !== 0) ? t('shift.gap', { total: signed(children.data.total.gap) }) : null))

// ---- Lugares: the children of the place, with the largest gains ---------------------------------------------------------------------
const crumbs = computed(() => [{ label: t('common.brazil'), href: href(year.value, 'shift', [], keepTab.value) }, ...args.value.map((a, i) => ({ label: i === 0 ? stateTitle(a) : i === 2 ? t('shift.zone', { zone: a }) : a, href: href(year.value, 'shift', args.value.slice(0, i + 1), keepTab.value) }))])
const childName = (r) => (level.value === 'country' ? stateTitle(r.k) : level.value === 'zone' ? t('shift.section', { section: r.k }) : level.value === 'state' ? r.k : t('shift.zone', { zone: r.k }))
const childHref = (r) => (level.value === 'zone' ? href(year.value, 'signals', [...args.value, r.k]) : href(year.value, 'shift', [...args.value, r.k], keepTab.value))
const sc = reactive({ key: 'result', dir: 'desc' })
const valueOf = (r, key) => (key in r.d ? r.d[key] : r[key])
const sorted = computed(() => [...(children.data?.rows ?? [])].sort((x, y) => (sc.dir === 'asc' ? 1 : -1) * (sc.key === 'k' ? (x.k < y.k ? -1 : 1) : valueOf(x, sc.key) - valueOf(y, sc.key))))
const onSort = (key) => Object.assign(sc, { key, dir: sc.key === key && sc.dir === 'desc' ? 'asc' : 'desc' })
const delta = (key, name) => ({ key, label: t('shift.col.delta', { name }), num: true, sortable: true, fmt: (_, r) => signed(r.d[key]) })
const cols = computed(() => [
  { key: 'k', label: t(`shift.col.${CHILD[level.value]}`), sortable: true, fmt: (_, r) => childName(r), href: childHref },
  delta('a', names.value.a), delta('b', names.value.b),
  { key: 'others1', label: t('shift.col.others'), num: true, sortable: true, fmt: int }, { key: 'result', label: t('shift.col.result'), num: true, sortable: true, fmt: (_, r) => signed(r.result) },
])
const largest = computed(() => sorted.value.slice(0, TOP).map((r) => ({ label: childName(r), value: Math.max(r.result, 0), text: signed(r.result), href: childHref(r) })))

// ---- Casos: places where the winner turned, the margin moved most, or a finalist gained very little ----------------------------------------
const cityHref = (r) => href(year.value, 'shift', [r.state, r.city])
const cityCol = { key: 'city', label: t('shift.col.city'), fmt: (v, r) => `${v} · ${r.state.toUpperCase()}`, href: cityHref }
const turnedRows = computed(() => (cities.data ?? []).filter((r) => r.turned).map((r) => {
  const g = governors.data?.get(`${r.state}/${r.city}`)
  return { ...r, governor: g, linked: g ? linkedTo(g.bloc, A.value, B.value) : null }
}).sort((x, y) => y.result - x.result))
const turnedSummary = computed(() => {
  const rows = turnedRows.value
  const by = (v) => rows.filter((r) => r.linked === v).length
  return { total: rows.length, toA: rows.filter((r) => r.w2 === 'a').length, toB: rows.filter((r) => r.w2 === 'b').length, withA: by('a'), withB: by('b'), others: rows.filter((r) => !r.linked).length }
})
const turnedCols = computed(() => [
  { ...cityCol, label: t('shift.col.city') },
  { key: 'a1', label: t('shift.col.first', { name: names.value.a }), num: true, fmt: int }, { key: 'a2', label: t('shift.col.second', { name: names.value.a }), num: true, fmt: int },
  { key: 'b1', label: t('shift.col.first', { name: names.value.b }), num: true, fmt: int }, { key: 'b2', label: t('shift.col.second', { name: names.value.b }), num: true, fmt: int },
  { key: 'governor', label: t('shift.col.governor'), fmt: (g) => (g ? `${g.name} · ${g.party} · ${t(`spectrum.bloc.${g.bloc}`)}` : '–') },
  { key: 'linked', label: t('shift.col.linked'), fmt: (v) => (v ? names.value[v] : t('shift.neither')) },
])
const margin = (a, b) => (a + b ? (a - b) / (a + b) : 0)
const bigRows = computed(() => (cities.data ?? []).filter((r) => r.a2 + r.b2 >= BIG).map((r) => ({ ...r, swing: margin(r.a2, r.b2) - margin(r.a1, r.b1) })).sort((x, y) => Math.abs(y.swing) - Math.abs(x.swing)).slice(0, TOP))
const bigCols = computed(() => [
  cityCol, { key: 'm1', label: t('shift.col.margin1'), num: true, fmt: (_, r) => signed(100 * margin(r.a1, r.b1), 1) }, { key: 'm2', label: t('shift.col.margin2'), num: true, fmt: (_, r) => signed(100 * margin(r.a2, r.b2), 1) },
  { key: 'swing', label: t('shift.col.swing'), num: true, fmt: (v) => signed(100 * v, 1) }, { key: 'result', label: t('shift.col.result'), num: true, fmt: (v) => signed(v) },
])
const who = computed(() => (route.value.params.get('who') === 'b' ? 'b' : 'a'))
const grain = computed(() => (route.value.params.get('grain') === 'section' ? 'section' : 'zone'))
const smallRows = use(async (y, { s }, r) => {
  if (tab.value !== 'cases' || kase.value !== 'small' || !s) return null
  const rows = (await r(unitsSql(grain.value, y, ...numbers(), s))).map((u) => ({ ...u, d: { a: u.a2 - u.a1, b: u.b2 - u.b1 } })).filter((u) => u.d[who.value] >= 0 && u.d[who.value] <= SMALL)
  const counts = Array.from({ length: SMALL + 1 }, (_, v) => rows.filter((u) => u.d[who.value] === v).length)
  return { rows: rows.sort((x, y) => x.d[who.value] - y.d[who.value]), counts }
})
const smallCols = computed(() => [
  { key: 'city', label: t('shift.col.city'), fmt: (v, r) => `${v} · ${t('shift.zone', { zone: r.zone })}${r.section ? ` · ${t('shift.section', { section: r.section })}` : ''}`, href: (r) => href(year.value, 'shift', [state.value, r.city, r.zone]) },
  { key: 'a1', label: t('shift.col.first', { name: names.value.a }), num: true, fmt: int }, { key: 'a2', label: t('shift.col.second', { name: names.value.a }), num: true, fmt: int }, delta('a', names.value.a),
  { key: 'b1', label: t('shift.col.first', { name: names.value.b }), num: true, fmt: int }, { key: 'b2', label: t('shift.col.second', { name: names.value.b }), num: true, fmt: int }, delta('b', names.value.b),
])
const pickWho = (e) => setParam('who', e.target.value === 'a' ? null : e.target.value)
const pickGrain = (e) => setParam('grain', e.target.value === 'zone' ? null : e.target.value)
const pickState = (e) => go(href(year.value, 'shift', e.target.value ? [e.target.value] : [], { tab: 'cases', case: 'small' }))

const tabItems = computed(() => TABS.map((id) => ({ href: href(year.value, 'shift', args.value, id === TABS[0] ? {} : { tab: id }), label: t(`shift.tab.${id}`), current: id === tab.value })))
const caseItems = computed(() => CASES.map((id) => ({ value: id, label: t(`shift.case.${id}`) })))
</script>

<template lang="pug">
h1 {{ t('shift.title', { place, election: electionLabel(year) }) }}
p.muted {{ t('shift.caution') }}
Breadcrumb(:items="crumbs" :label="t('shift.breadcrumb')")
Tabs(:items="tabItems" :label="t('shift.tabs')")
Notice(v-if="base.error || finalists.error" kind="danger") {{ (base.error ?? finalists.error).message }}
p.muted(v-else-if="!finalists.data" role="status") {{ t('shift.loading') }}
.grid-auto(v-else)
  template(v-if="tab === 'votes'")
    Panel(:title="t('shift.flow.title', { a: names.a, b: names.b })" :state="estimation" :election="year" wide)
      .cluster
        Stat(v-for="s in headline" :key="s[1]" :value="s[0]" :label="s[1]")
      template(v-if="estimation.data")
        p.muted {{ t('shift.flow.note', { a: names.a, b: names.b }) }}
        Notice(v-if="estimation.data.thin" kind="note") {{ t('shift.thin') }}
        Legend(:items="legend")
        .table-wrap(tabindex="0" role="region" :aria-label="t('shift.flow.title', { a: names.a, b: names.b })")
          table.table
            thead
              tr
                th {{ t('shift.flow.origin') }}
                th.num {{ t('shift.flow.votes') }}
                th {{ t('shift.flow.support') }}
                th {{ t('shift.flow.where') }}
                th.num {{ names.a }}
                th.num {{ names.b }}
            tbody
              tr(v-for="g in flowRows" :key="g.label")
                td
                  i.legend__swatch(v-if="g.id === 'c'" :style="{ background: partyColor(g.party) }")
                  | {{ g.label }}
                td.num {{ int(g.votes) }}
                td {{ g.support ? `→ ${g.support}` : '–' }}
                td
                  .flow
                    span.flow__part(v-for="s in g.segments" :key="s.id" :style="{ width: `${100 * s.share}%`, background: fills[s.id] }" :title="s.title")
                td.num
                  | {{ int(g.to[0]) }}
                  span.muted  {{ pct(g.share[0], 0) }}
                td.num
                  | {{ int(g.to[1]) }}
                  span.muted  {{ pct(g.share[1], 0) }}
        p.muted {{ fitNote }}
      p.muted(v-else-if="!estimation.loading") {{ t('shift.noEstimate') }}
    Panel(v-if="supportRows.length" :title="t('shift.support.title')" :state="estimation" :election="year")
      p.muted {{ t('shift.support.note') }}
      DataTable(:columns="supportCols" :rows="supportRows")
    Panel(:title="t('shift.identity.title')" :state="children" :election="year")
      p.muted {{ t('shift.identity.note', { a: names.a, b: names.b }) }}
      DataTable(:columns="poolCols" :rows="poolRows")
      Notice(v-if="gapNote" kind="note") {{ gapNote }}
  template(v-else-if="tab === 'places'")
    Panel(:title="t(`shift.children.${level}`)" :state="children" :election="year" wide)
      DataTable(:columns="cols" :rows="sorted" :sort="sc" @sort="onSort")
    Panel(:title="t('shift.largest')" :state="children" :election="year")
      p.muted {{ t('shift.largestNote') }}
      BarList(:items="largest")
  template(v-else)
    ButtonGroup(:label="t('shift.cases')" :items="caseItems" :value="kase" @change="(v) => setParam('case', v === 'turned' ? null : v)")
    Panel(v-if="kase === 'turned'" :title="t('shift.turnedTitle')" :state="governors" :election="year" wide)
      p {{ t('shift.turnedSummary', { total: int(turnedSummary.total), a: names.a, b: names.b, toA: int(turnedSummary.toA), toB: int(turnedSummary.toB) }) }}
      p {{ t('shift.turnedGovernors', { a: names.a, b: names.b, withA: int(turnedSummary.withA), withB: int(turnedSummary.withB), others: int(turnedSummary.others) }) }}
      p.muted {{ t('shift.turnedNote') }}
      DataTable(:columns="turnedCols" :rows="turnedRows")
    Panel(v-else-if="kase === 'big'" :title="t('shift.bigTitle', { top: TOP })" :state="cities" :election="year" wide)
      p.muted {{ t('shift.bigNote', { votes: int(BIG) }) }}
      DataTable(:columns="bigCols" :rows="bigRows")
    Panel(v-else :title="t('shift.smallTitle', { max: SMALL })" :state="smallRows" :election="year" wide)
      p.muted {{ t('shift.smallNote', { max: SMALL }) }}
      .cluster
        Field(:label="t('common.state')")
          select(:value="state ?? ''" @change="pickState")
            option(value="") –
            option(v-for="s in statesIn('rdv', year)" :key="s" :value="s") {{ stateTitle(s) }}
        Field(:label="t('shift.who')")
          select(:value="who" @change="pickWho")
            option(value="a") {{ names.a }}
            option(value="b") {{ names.b }}
        Field(:label="t('shift.grain')")
          select(:value="grain" @change="pickGrain")
            option(value="zone") {{ t('shift.col.zone') }}
            option(value="section") {{ t('shift.col.section') }}
      p.muted(v-if="!state") {{ t('shift.pickState') }}
      template(v-else-if="smallRows.data")
        p {{ t('shift.smallTotal', { n: int(smallRows.data.rows.length), name: names[who], max: SMALL }) }}
        ColumnChart(:label="t('shift.smallTitle', { max: SMALL })" :values="smallRows.data.counts" :labels="smallRows.data.counts.map((_, v) => String(v))" :height="220" :tick="int" :fmt="int")
        DataTable(:columns="smallCols" :rows="smallRows.data.rows.slice(0, 200)")
</template>
