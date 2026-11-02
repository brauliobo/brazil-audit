<script setup vapor>
import { computed, reactive } from 'vue'
import { route, href, setParam, go } from '../router'
import { ELECTIONS } from '../model'
import { electionLabel, stateName, stateTitle } from '../labels'
import { t } from '../i18n'
import { ensure, ensureOffice, ensureScope, ensureSmall, ensureState, statesIn } from '../data'
import { useAsync } from '../use'
import { objects } from '../db'
import { int, num, pct, signed } from '../format'
import { childrenSql, citiesSql, finalistsSql, firstRoundOf, governorsSql, levelOf, linkedTo, othersSql, pools, poolShare, shiftOf, totalOf, unitsSql } from '../shift'
import Panel from '../components/Panel.vue'
import Notice from '../components/Notice.vue'
import Tabs from '../components/Tabs.vue'
import Stat from '../components/Stat.vue'
import Breadcrumb from '../components/Breadcrumb.vue'
import DataTable from '../components/DataTable.vue'
import BarList from '../components/BarList.vue'
import Field from '../components/Field.vue'
import ColumnChart from '../components/ColumnChart.vue'

const TABS = ['places', 'turned', 'small', 'big', 'sources']
const BIG = 80000 // the larger municipalities: at least this many votes for the finalists in the runoff
const TOP = 10
const SMALL = 20 // a finalist gained from 0 to this many votes

const year = computed(() => route.value.election)
const yr = computed(() => ELECTIONS[year.value].year) // the `election` column of the tables
const first = computed(() => firstRoundOf(year.value))
const args = computed(() => route.value.args)
const state = computed(() => args.value[0] ?? null)
const city = computed(() => args.value[1] ?? null)
const zone = computed(() => args.value[2] ?? null)
const level = computed(() => levelOf(args.value))
const CHILD = { country: 'state', state: 'city', zone: 'section', city: 'zone' }
const tab = computed(() => (TABS.includes(route.value.params.get('tab')) ? route.value.params.get('tab') : 'places'))
const keepTab = computed(() => (tab.value === 'places' ? {} : { tab: tab.value }))

// the rollups of every state and the sections of the state in view, for both rounds
const base = useAsync(() => [year.value, first.value, state.value, city.value], async ([y, f, s, c]) => {
  const both = [f, y]
  await Promise.all([ensure('cands'), ensure('spectrum'), ensure('endorsement'), ...both.flatMap((e) => [ensureSmall(e, 'sgz', 'residual'), ensureOffice('res', e, 1), ensureOffice('tot', e, 1)])])
  if (s && (c || tab.value === 'small')) await Promise.all(both.flatMap((e) => [ensureScope('rdv', e, s), ...(c ? [ensureState('sg', e, s)] : [])]))
  return true
})
const use = (run) => useAsync(() => [yr.value, state.value, city.value, zone.value, String(route.value.params), base.loading, finalists.data], async ([y, s, c, z], q) =>
  base.loading || !finalists.data ? null : run(y, { s, c, z }, async ({ sql, params }) => objects(await q(sql, params))))

const finalists = useAsync(() => [yr.value, base.loading], async ([y], q) => (base.loading ? null : (objects(await q(...Object.values(finalistsSql(y)))))))
const [A, B] = [computed(() => finalists.data?.[0]), computed(() => finalists.data?.[1])]
const names = computed(() => ({ a: A.value?.name, b: B.value?.name }))
const numbers = () => [A.value.n, B.value.n]

const children = use(async (y, { s, c, z }, r) => {
  const rows = (await r(childrenSql([s, c, z].filter(Boolean), y, ...numbers()))).map(shiftOf)
  return { rows, total: totalOf(rows) }
})
const others = use(async (y, { s, c, z }, r) => (tab.value === 'places' || tab.value === 'sources' ? r(othersSql([s, c, z].filter(Boolean), y, ...numbers())) : null))
const cities = use(async (y, _place, r) => (['turned', 'big'].includes(tab.value) ? (await r(citiesSql(y, ...numbers()))).map(shiftOf) : null))
const governors = use(async (y, _p, r) => {
  if (tab.value !== 'turned') return null
  await ensureOffice('res', first.value, 3)
  return new Map((await r(governorsSql(y))).map((g) => [`${g.state}/${g.city}`, g]))
})

// ---- table ------------------------------------------------------------------------------------------------------------------
const place = computed(() => (zone.value ? t('shift.zone', { zone: zone.value }) : city.value ?? (state.value ? stateName(state.value) : t('common.brazil'))))
const crumbs = computed(() => {
  const items = [{ label: t('common.brazil'), href: href(year.value, 'shift', [], keepTab.value) }]
  args.value.forEach((a, i) => items.push({ label: i === 0 ? stateTitle(a) : i === 2 ? t('shift.zone', { zone: a }) : a, href: href(year.value, 'shift', args.value.slice(0, i + 1), keepTab.value) }))
  return items
})
const childName = (r) => (level.value === 'country' ? stateTitle(r.k) : level.value === 'zone' ? t('shift.section', { section: r.k }) : level.value === 'state' ? r.k : t('shift.zone', { zone: r.k }))
const childHref = (r) => (level.value === 'zone' ? href(year.value, 'signals', [...args.value, r.k]) : href(year.value, 'shift', [...args.value, r.k], keepTab.value))
const sc = reactive({ key: 'result', dir: 'desc' })
const sorted = computed(() => [...(children.data?.rows ?? [])].sort((x, y) => (sc.dir === 'asc' ? 1 : -1) * ((sc.key === 'k' ? (x.k < y.k ? -1 : 1) : valueOf(x, sc.key) - valueOf(y, sc.key)))))
const valueOf = (r, key) => (key in r.d ? r.d[key] : r[key])
const onSort = (key) => Object.assign(sc, { key, dir: sc.key === key && sc.dir === 'desc' ? 'asc' : 'desc' })
const delta = (key, label, params) => ({ key, label: t(label, params), num: true, sortable: true, fmt: (_, r) => signed(r.d[key]) })
const cols = computed(() => [
  { key: 'k', label: t(`shift.col.${CHILD[level.value]}`), sortable: true, fmt: (_, r) => childName(r), href: childHref },
  { key: 'a1', label: t('shift.col.first', { name: names.value.a }), num: true, sortable: true, fmt: int }, { key: 'a2', label: t('shift.col.second', { name: names.value.a }), num: true, sortable: true, fmt: int }, delta('a', 'shift.col.delta', { name: names.value.a }),
  { key: 'b1', label: t('shift.col.first', { name: names.value.b }), num: true, sortable: true, fmt: int }, { key: 'b2', label: t('shift.col.second', { name: names.value.b }), num: true, sortable: true, fmt: int }, delta('b', 'shift.col.delta', { name: names.value.b }),
  delta('nu', 'shift.col.nulls'), delta('bl', 'shift.col.blanks'), delta('abs', 'shift.col.abstention'), delta('ap', 'shift.col.electorate'),
  { key: 'others1', label: t('shift.col.others'), num: true, sortable: true, fmt: int }, { key: 'result', label: t('shift.col.result'), num: true, sortable: true, fmt: (_, r) => signed(r.result) },
])
const stats = computed(() => {
  const s = children.data?.total
  return s ? [[signed(s.d.a), t('shift.col.delta', { name: names.value.a })], [signed(s.d.b), t('shift.col.delta', { name: names.value.b })], [int(s.others1), t('shift.col.others')], [signed(s.result), t('shift.col.result')]] : []
})
const poolRows = computed(() => (children.data ? pools(children.data.total).map((p) => ({ ...p, share: poolShare(p.value, children.data.total) })) : []))
const poolCols = computed(() => [
  { key: 'id', label: t('shift.pool.source'), fmt: (v) => t(`shift.pool.${v}`) },
  { key: 'value', label: t('shift.pool.votes'), num: true, fmt: (v) => signed(v) },
  { key: 'share', label: t('shift.pool.share'), num: true, fmt: (v) => (v == null ? '–' : pct(v, 1)) },
])
const largest = computed(() => sorted.value.slice(0, TOP).map((r) => ({ label: childName(r), value: Math.max(r.result, 0), text: signed(r.result), href: childHref(r) })))
const gapNote = computed(() => (children.data?.rows.some((r) => r.gap !== 0) ? t('shift.gap', { total: signed(children.data.total.gap) }) : null))
const declaredName = (n) => (n === A.value?.n ? names.value.a : n === B.value?.n ? names.value.b : null)
const otherRows = computed(() => (others.data ?? []).map((o) => ({ ...o, votes: Number(o.votes) })))
const otherItems = computed(() => otherRows.value.map((o) => ({ label: `${o.name} · ${o.party ?? ''}`, value: o.votes, text: `${int(o.votes)}${o.declared ? ` → ${declaredName(o.declared) ?? o.declared}` : ''}` })))

// ---- Virou: places where the finalists swapped, with the governor of the first round ------------------------------------------------
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
  { key: 'city', label: t('shift.col.city'), fmt: (v, r) => `${v} · ${r.state.toUpperCase()}`, href: (r) => href(year.value, 'shift', [r.state, r.city]) },
  { key: 'a1', label: t('shift.col.first', { name: names.value.a }), num: true, fmt: int }, { key: 'a2', label: t('shift.col.second', { name: names.value.a }), num: true, fmt: int },
  { key: 'b1', label: t('shift.col.first', { name: names.value.b }), num: true, fmt: int }, { key: 'b2', label: t('shift.col.second', { name: names.value.b }), num: true, fmt: int },
  { key: 'result', label: t('shift.col.result'), num: true, fmt: (v) => signed(v) },
  { key: 'governor', label: t('shift.col.governor'), fmt: (g, r) => (g ? `${g.name} · ${g.party} · ${t(`spectrum.bloc.${g.bloc}`)}` : '–') },
  { key: 'linked', label: t('shift.col.linked'), fmt: (v) => (v ? names.value[v] : t('shift.neither')) },
])

// ---- Mudou muito: the larger municipalities whose margin moved most --------------------------------------------------------------------
const margin = (a, b) => (a + b ? (a - b) / (a + b) : 0)
const bigRows = computed(() => (cities.data ?? []).filter((r) => r.a2 + r.b2 >= BIG).map((r) => ({ ...r, swing: margin(r.a2, r.b2) - margin(r.a1, r.b1) })).sort((x, y) => Math.abs(y.swing) - Math.abs(x.swing)).slice(0, TOP))
const bigCols = computed(() => [
  { key: 'city', label: t('shift.col.city'), fmt: (v, r) => `${v} · ${r.state.toUpperCase()}`, href: (r) => href(year.value, 'shift', [r.state, r.city]) },
  { key: 'm1', label: t('shift.col.margin1'), num: true, fmt: (_, r) => signed(100 * margin(r.a1, r.b1), 1) }, { key: 'm2', label: t('shift.col.margin2'), num: true, fmt: (_, r) => signed(100 * margin(r.a2, r.b2), 1) },
  { key: 'swing', label: t('shift.col.swing'), num: true, fmt: (v) => signed(100 * v, 1) },
  { key: 'result', label: t('shift.col.result'), num: true, fmt: (v) => signed(v) },
])

// ---- Aumento pequeno: zones or sections where a finalist gained 0 to 20 votes ----------------------------------------------------------
const who = computed(() => (route.value.params.get('who') === 'b' ? 'b' : 'a'))
const grain = computed(() => (route.value.params.get('grain') === 'section' ? 'section' : 'zone'))
const smallRows = use(async (y, { s }, r) => {
  if (tab.value !== 'small' || !s) return null
  const rows = (await r(unitsSql(grain.value, y, ...numbers(), s))).map((u) => ({ ...u, d: { a: u.a2 - u.a1, b: u.b2 - u.b1 } })).filter((u) => u.d[who.value] >= 0 && u.d[who.value] <= SMALL)
  const counts = Array.from({ length: SMALL + 1 }, (_, v) => rows.filter((u) => u.d[who.value] === v).length)
  return { rows: rows.sort((x, y) => x.d[who.value] - y.d[who.value]), counts }
})
const smallCols = computed(() => [
  { key: 'city', label: t('shift.col.city'), fmt: (v, r) => `${v} · ${t('shift.zone', { zone: r.zone })}${r.section ? ` · ${t('shift.section', { section: r.section })}` : ''}`, href: (r) => href(year.value, 'shift', [state.value, r.city, r.zone]) },
  { key: 'a1', label: t('shift.col.first', { name: names.value.a }), num: true, fmt: int }, { key: 'a2', label: t('shift.col.second', { name: names.value.a }), num: true, fmt: int }, delta('a', 'shift.col.delta', { name: names.value.a }),
  { key: 'b1', label: t('shift.col.first', { name: names.value.b }), num: true, fmt: int }, { key: 'b2', label: t('shift.col.second', { name: names.value.b }), num: true, fmt: int }, delta('b', 'shift.col.delta', { name: names.value.b }),
])
const pickWho = (e) => setParam('who', e.target.value === 'a' ? null : e.target.value)
const pickGrain = (e) => setParam('grain', e.target.value === 'zone' ? null : e.target.value)
const pickState = (e) => go(href(year.value, 'shift', e.target.value ? [e.target.value] : [], { tab: 'small' }))

// ---- Simulação: the user splits each pool between the finalists --------------------------------------------------------------------------
const split = reactive({})
const simRows = computed(() => {
  const s = children.data?.total
  if (!s) return []
  const poolSources = pools(s).filter((p) => p.id !== 'others' && p.id !== 'ap').map((p) => ({ id: p.id, name: t(`shift.pool.${p.id}`), base: p.value }))
  const sources = [...poolSources, ...otherRows.value.map((o) => ({ id: `c${o.n}`, name: o.name, base: o.votes }))]
  return sources.map((x) => ({ ...x, a: +(split[`${x.id}:a`] ?? 0), b: +(split[`${x.id}:b`] ?? 0) }))
})
const simTotals = computed(() => ({ a: simRows.value.reduce((n, r) => n + r.base * r.a / 100, 0), b: simRows.value.reduce((n, r) => n + r.base * r.b / 100, 0) }))
const setSplit = (id, side, e) => { split[`${id}:${side}`] = e.target.value }
const tabItems = computed(() => TABS.map((id) => ({ href: href(year.value, 'shift', id === 'small' ? args.value.slice(0, 1) : args.value, id === 'places' ? {} : { tab: id }), label: t(`shift.tab.${id}`), current: id === tab.value })))
</script>

<template lang="pug">
h1 {{ t('shift.title', { place, election: electionLabel(year) }) }}
Notice(kind="warning") {{ t('shift.caution') }}
Breadcrumb(:items="crumbs" :label="t('shift.breadcrumb')")
Tabs(:items="tabItems" :label="t('shift.tabs')")
Notice(v-if="base.error || finalists.error" kind="danger") {{ (base.error ?? finalists.error).message }}
p.muted(v-else-if="!finalists.data" role="status") {{ t('shift.loading') }}
.grid-auto(v-else)
  template(v-if="tab === 'places'")
    Panel(:title="t('shift.summary', { a: names.a, b: names.b })" :state="children" :election="year" wide)
      .cluster
        Stat(v-for="s in stats" :key="s[1]" :value="s[0]" :label="s[1]")
      p {{ t('shift.identity', { a: names.a, b: names.b }) }}
      p.muted {{ t('shift.deltaNote') }}
      Notice(v-if="gapNote" kind="note") {{ gapNote }}
      DataTable(:columns="poolCols" :rows="poolRows")
    Panel(:title="t('shift.largest')" :state="children" :election="year")
      p.muted {{ t('shift.largestNote') }}
      BarList(:items="largest")
    Panel(:title="t('shift.others')" :state="others" :election="year")
      p.muted {{ t('shift.othersNote', { a: names.a, b: names.b }) }}
      BarList(:items="otherItems")
    Panel(:title="t(`shift.children.${level}`)" :state="children" :election="year" wide)
      DataTable(:columns="cols" :rows="sorted" :sort="sc" @sort="onSort")
  template(v-else-if="tab === 'turned'")
    Panel(:title="t('shift.turnedTitle')" :state="governors" :election="year" wide)
      p {{ t('shift.turnedSummary', { total: int(turnedSummary.total), a: names.a, b: names.b, toA: int(turnedSummary.toA), toB: int(turnedSummary.toB) }) }}
      p {{ t('shift.turnedGovernors', { a: names.a, b: names.b, withA: int(turnedSummary.withA), withB: int(turnedSummary.withB), others: int(turnedSummary.others) }) }}
      p.muted {{ t('shift.turnedNote') }}
      DataTable(:columns="turnedCols" :rows="turnedRows")
  template(v-else-if="tab === 'big'")
    Panel(:title="t('shift.bigTitle', { top: TOP })" :state="cities" :election="year" wide)
      p.muted {{ t('shift.bigNote', { votes: int(BIG) }) }}
      DataTable(:columns="bigCols" :rows="bigRows")
  template(v-else-if="tab === 'small'")
    Panel(:title="t('shift.smallTitle', { max: SMALL })" :state="smallRows" :election="year" wide)
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
  template(v-else)
    Panel(:title="t('shift.simTitle')" :state="others" :election="year" wide)
      p.muted {{ t('shift.simNote') }}
      .table-wrap
        table.table
          thead
            tr
              th {{ t('shift.pool.source') }}
              th.num {{ t('shift.pool.votes') }}
              th.num {{ names.a }} %
              th.num {{ names.b }} %
          tbody
            tr(v-for="r in simRows" :key="r.id")
              td {{ r.name }}
              td.num {{ signed(r.base) }}
              td.num
                input(type="number" min="0" max="100" :value="r.a" :aria-label="`${r.name} · ${names.a} %`" @input="setSplit(r.id, 'a', $event)")
              td.num
                input(type="number" min="0" max="100" :value="r.b" :aria-label="`${r.name} · ${names.b} %`" @input="setSplit(r.id, 'b', $event)")
      p {{ t('shift.simTotals', { a: names.a, b: names.b, simA: signed(simTotals.a), simB: signed(simTotals.b), goalA: signed(children.data?.total.d.a ?? 0), goalB: signed(children.data?.total.d.b ?? 0) }) }}
</template>
