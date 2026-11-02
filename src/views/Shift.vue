<script setup vapor>
import { computed, markRaw, reactive } from 'vue'
import { route, href, setParam, go } from '../router'
import { ELECTIONS, runoffOf, shiftOffices } from '../model'
import { electionLabel, stateTitle } from '../labels'
import { partyColor } from '../colors'
import { t } from '../i18n'
import { ensure } from '../data'
import { useAsync } from '../use'
import { objects } from '../db'
import { int, pct, signed } from '../format'
import { DEPTH, candidatesSql, grainOf, placesSql, roundsOf, unitsSql, votesSql } from '../contest'
import { contestParts, ensureContest, loadedCount } from '../contest-load'
import { childrenOf, citiesOf, contestsOf, governorsOf, levelOf, linkedTo, pools, poolShare, rosterOf, totalOf, transfersOf, within } from '../shift'
import Panel from '../components/Panel.vue'
import Notice from '../components/Notice.vue'
import Tabs from '../components/Tabs.vue'
import Stat from '../components/Stat.vue'
import Legend from '../components/Legend.vue'
import ButtonGroup from '../components/ButtonGroup.vue'
import DataTable from '../components/DataTable.vue'
import BarList from '../components/BarList.vue'
import ColumnChart from '../components/ColumnChart.vue'
import Field from '../components/Field.vue'

const TABS = ['votes', 'places', 'cases']
const CASES = ['turned', 'big', 'small']
const BIG = 80000 // the larger municipalities: at least this many votes for the finalists in the runoff
const TOP = 10
const SMALL = 20 // a finalist gained from 0 to this many votes
const SHOWN = 0.001 // a candidate under this share of the first-round votes shares the row of the remaining candidates

const key = computed(() => runoffOf(route.value.election)) // the first round shows the same comparison as its runoff
const year = computed(() => ELECTIONS[key.value].year)
const offices = computed(() => shiftOffices(key.value))
const office = computed(() => (offices.value.includes(route.value.params.get('office')) ? route.value.params.get('office') : offices.value[0]))
const depth = computed(() => DEPTH[office.value])
const args = computed(() => route.value.args)
const param = (name, allowed) => computed(() => (allowed.includes(route.value.params.get(name)) ? route.value.params.get(name) : allowed[0]))
const [tab, kase] = [param('tab', TABS), param('case', CASES)]
const link = (to, extra = {}) => href(key.value, 'shift', to, { ...(office.value === offices.value[0] ? {} : { office: office.value }), ...extra })
const keepTab = computed(() => (tab.value === TABS[0] ? {} : { tab: tab.value }))

// ---- data: both rounds of the office at the finest grain, loaded once per election and office --------------------------------------------------
const base = useAsync(() => [key.value, office.value, args.value[0] ?? null], async ([k, o], q) => {
  const rounds = roundsOf(k, o)
  const grain = grainOf(rounds, o)
  if (!grain) throw new Error(t('shift.noGrain'))
  await Promise.all([ensureContest(rounds, o, null, grain), ensure('spectrum'), ensure('endorsement')])
  await ensureContest(rounds, o, o === 'mayor' ? '*' : args.value[0] ?? null, grain)
  const run = async ({ sql, params }) => objects(await q(sql, params))
  const [rows, votes, candidates, names, spectrum, endorsements] = await Promise.all([
    run(unitsSql(rounds, o, grain)), run(votesSql(rounds, o, grain)), run(candidatesSql(rounds, o, null, grain)), run(placesSql(rounds, null, grain)),
    run({ sql: 'select * from spectrum', params: [] }), o === 'president' ? run({ sql: 'select n, to_n from endorsement where election = $1 and turn = 2', params: [ELECTIONS[k].year] }) : [],
  ])
  const cities = new Map(names.map((c) => [`${c.state}|${c.city}`, c.name]))
  return markRaw({ rounds, grain, rows, votes, candidates, cities, spectrum, endorsements, contests: contestsOf(rows, votes, DEPTH[o]) })
})
const data = computed(() => base.data)
const progress = computed(() => { const rounds = roundsOf(key.value, office.value); const parts = grainOf(rounds, office.value) === 'native' ? [] : contestParts(rounds, office.value, null); return { done: loadedCount(parts), all: parts.length } })
const cityName = (state, city) => data.value.cities.get(`${state}|${city}`) ?? city
const candidate = (c, number) => data.value.candidates.find((x) => x.number === number && (!x.state || x.state === c.state) && (!x.city || x.city === c.city))

const contest = computed(() => (data.value && args.value.length >= depth.value ? data.value.contests.find((c) => c.key === args.value.slice(0, depth.value).join('|')) ?? null : null))
const indexed = computed(() => !!data.value && depth.value > args.value.length)
const missing = computed(() => !!data.value && !indexed.value && !contest.value)
const places = computed(() => contest.value?.places ?? [])
const names = computed(() => ({ a: candidate(contest.value, contest.value.a)?.name ?? contest.value.a, b: candidate(contest.value, contest.value.b)?.name ?? contest.value.b }))
const level = computed(() => levelOf(args.value))
const where = computed(() => (args.value.length > 2 ? t('shift.zone', { zone: args.value[2] }) : args.value.length > 1 ? cityName(args.value[0], args.value[1]) : stateTitle(args.value[0])))
const title = computed(() => [t('shift.title', { office: t(`shift.office.${office.value}`), election: electionLabel(key.value) }), data.value && contest.value && args.value.length ? where.value : ''].filter(Boolean).join(' · '))

// ---- the context bar: office, state and municipality ---------------------------------------------------------------------------------------
const states = computed(() => [...new Set((data.value?.contests ?? []).map((c) => c.state))].sort())
const cityOptions = computed(() => [...new Map((data.value?.contests ?? []).filter((c) => c.state === args.value[0]).flatMap((c) => c.places).map((p) => [p.city, cityName(p.state, p.city)])).entries()].sort((x, y) => (x[1] < y[1] ? -1 : 1)))
const officeItems = computed(() => offices.value.map((o) => ({ value: o, label: t(`shift.office.${o}`) })))
const pickOffice = (o) => go(href(key.value, 'shift', [], o === offices.value[0] ? {} : { office: o }))
const pickState = (e) => go(link(e.target.value ? [e.target.value] : [], keepTab.value))
const pickCity = (e) => go(link(e.target.value ? [args.value[0], e.target.value] : [args.value[0]], keepTab.value))
const tabItems = computed(() => TABS.map((id) => ({ href: link(args.value, id === TABS[0] ? {} : { tab: id }), label: t(`shift.tab.${id}`), current: id === tab.value })))

// ---- the contests of governors and mayors: one row each --------------------------------------------------------------------------------------
const contestRows = computed(() => (data.value?.contests ?? []).filter((c) => args.value.every((v, i) => v === [c.state, c.city][i])).map((c) => {
  const [a, b] = [candidate(c, c.a)?.name ?? c.a, candidate(c, c.b)?.name ?? c.b]
  return { ...c, label: depth.value === 1 ? stateTitle(c.state) : `${cityName(c.state, c.city)} · ${c.state.toUpperCase()}`, finalists: `${a} · ${b}`, gain: c.total.d.a + c.total.d.b }
}).sort((x, y) => y.gain - x.gain))
const contestCols = computed(() => [
  { key: 'label', label: t(depth.value === 1 ? 'shift.col.state' : 'shift.col.city'), href: (r) => link(depth.value === 1 ? [r.state] : [r.state, r.city]) },
  { key: 'finalists', label: t('shift.col.finalists') }, { key: 'gain', label: t('shift.col.result'), num: true, fmt: (v) => signed(v) },
])

// ---- the answer in one place: how much each finalist gained, and what the eliminated candidates left --------------------------------------------
const children = computed(() => (contest.value ? childrenOf(places.value, args.value) : []))
const total = computed(() => totalOf(children.value))
const stats = computed(() => [
  [signed(total.value.d.a), t('shift.stat.gain', { name: names.value.a, from: int(total.value.a1), to: int(total.value.a2) })],
  [signed(total.value.d.b), t('shift.stat.gain', { name: names.value.b, from: int(total.value.b1), to: int(total.value.b2) })],
  [int(total.value.others1), t('shift.stat.others')],
])

// ---- Para onde foram: where the voters of each first-round group went, estimated from how the places differ ----------------------------------
const SEGMENTS = [['a', 'var(--candidate-pt)'], ['b', 'var(--candidate-pl)'], ['blank', 'var(--candidate-other)'], ['abstention', 'var(--bar-track-bg)']] // i18n-ignore
const fills = Object.fromEntries(SEGMENTS)
const roster = computed(() => rosterOf(places.value, data.value.candidates.filter((c) => (!c.state || c.state === contest.value.state) && (!c.city || c.city === contest.value.city)), data.value.endorsements, data.value.spectrum, year.value))
const groupOf = (p) => (args.value.length ? p.city : p.state)
const estimation = computed(() => (contest.value && tab.value === 'votes' ? transfersOf(within(places.value, args.value), roster.value, contest.value.a, contest.value.b, groupOf) : null))
const outcome = (id) => (id === 'a' || id === 'b' ? names.value[id] : t(`shift.group.${id}`))
const legend = computed(() => SEGMENTS.map(([id, fill]) => ({ color: fill, label: outcome(id) })))
const groupName = (g) => (g.id === 'c' ? `${g.name} · ${g.party}` : g.id === 'a' || g.id === 'b' ? names.value[g.id] : t(`shift.group.${g.id}`))
const declaredName = (n) => (n === contest.value.a ? names.value.a : n === contest.value.b ? names.value.b : null)
const segmentsOf = (g) => SEGMENTS.map(([id], j) => ({ id, share: g.share[j], title: `${groupName(g)} → ${outcome(id)}: ${pct(g.share[j], 0)} (${pct(g.low[j], 0)}–${pct(g.high[j], 0)}) · ${int(g.to[j])}` }))
const merged = (rows) => {
  const votes = rows.reduce((n, g) => n + g.votes, 0)
  const by = (k) => rows[0].share.map((_, j) => (votes ? rows.reduce((n, g) => n + g[k][j] * g.votes, 0) / votes : 0))
  return { id: 'rest', votes, share: by('share'), low: by('low'), high: by('high'), to: rows[0].to.map((_, j) => rows.reduce((n, g) => n + g.to[j], 0)) }
}
const flowRows = computed(() => {
  const rows = estimation.value?.rows ?? []
  const sum = rows.reduce((n, g) => n + (g.id === 'blank' || g.id === 'abstention' ? 0 : g.votes), 0)
  const small = rows.filter((g) => g.id === 'rest' || (g.id === 'c' && g.votes < SHOWN * sum))
  const kept = rows.filter((g) => !small.includes(g))
  const at = kept.findIndex((g) => g.id === 'blank')
  return [...kept.slice(0, at), ...(small.length ? [merged(small)] : []), ...kept.slice(at)].map((g) => ({ ...g, label: groupName(g), support: declaredName(g.declared) })).map((g) => ({ ...g, segments: segmentsOf(g) }))
})
const answer = computed(() => {
  const rows = (estimation.value?.rows ?? []).filter((g) => g.id === 'c' || g.id === 'rest')
  const votes = rows.reduce((n, g) => n + g.votes, 0)
  if (!votes) return null
  const share = (j) => rows.reduce((n, g) => n + g.to[j], 0) / votes
  return t('shift.answer', { eliminated: int(votes), a: names.value.a, pa: pct(share(0), 0), b: names.value.b, pb: pct(share(1), 0), rest: pct(share(2) + share(3), 0) })
})
const fitNote = computed(() => t('shift.fit', { places: int(estimation.value.places), fit: pct(estimation.value.fit, 0) }))
const supportRows = computed(() => (estimation.value?.declared ?? []).map((d, k) => ({ ...d, name: names.value[k ? 'b' : 'a'], gain: total.value.d[k ? 'b' : 'a'], rate: d.declared ? d.followed / d.declared : null })).filter((d) => d.declared))
const supportCols = computed(() => [
  { key: 'name', label: t('shift.support.finalist') }, { key: 'gain', label: t('shift.support.gain'), num: true, fmt: (v) => signed(v) },
  { key: 'declared', label: t('shift.support.declared'), num: true, fmt: int }, { key: 'followed', label: t('shift.support.followed'), num: true, fmt: int },
  { key: 'rate', label: t('shift.support.rate'), num: true, fmt: (v) => pct(v, 0) },
])
const poolRows = computed(() => pools(total.value).map((p) => ({ ...p, share: poolShare(p.value, total.value) })))
const poolCols = computed(() => [
  { key: 'id', label: t('shift.pool.source'), fmt: (v) => t(`shift.pool.${v}`) }, { key: 'value', label: t('shift.pool.votes'), num: true, fmt: (v) => signed(v) },
  { key: 'share', label: t('shift.pool.share'), num: true, fmt: (v) => (v == null ? '–' : pct(v, 1)) },
])
const complete = computed(() => [total.value.ap1, total.value.ap2, total.value.co1, total.value.co2].every((v) => v > 0)) // the electorate and the turnout are known
const gapNote = computed(() => (complete.value && total.value.gap !== 0 ? t('shift.gap', { total: signed(total.value.gap) }) : null))

// ---- Por lugar: the children of the place, with the largest gains ----------------------------------------------------------------------------
const CHILD = { country: 'state', state: 'city', city: 'zone', zone: 'zone' }
const childName = (r) => (args.value.length === 0 ? stateTitle(r.k) : args.value.length === 1 ? cityName(args.value[0], r.k) : t('shift.zone', { zone: r.k }))
const childHref = (r) => (args.value.length < 2 ? link([...args.value, r.k], keepTab.value) : null)
const sc = reactive({ key: 'result', dir: 'desc' })
const valueOf = (r, k) => (k in r.d ? r.d[k] : r[k])
const sorted = computed(() => [...children.value].sort((x, y) => (sc.dir === 'asc' ? 1 : -1) * (sc.key === 'k' ? (childName(x) < childName(y) ? -1 : 1) : valueOf(x, sc.key) - valueOf(y, sc.key))))
const onSort = (k) => Object.assign(sc, { key: k, dir: sc.key === k && sc.dir === 'desc' ? 'asc' : 'desc' })
const delta = (k, name) => ({ key: k, label: t('shift.col.delta', { name }), num: true, sortable: true, fmt: (_, r) => signed(r.d[k]) })
const cols = computed(() => [
  { key: 'k', label: t(`shift.col.${CHILD[level.value]}`), sortable: true, fmt: (_, r) => childName(r), href: childHref },
  delta('a', names.value.a), delta('b', names.value.b),
  { key: 'others1', label: t('shift.col.others'), num: true, sortable: true, fmt: int }, { key: 'result', label: t('shift.col.result'), num: true, sortable: true, fmt: (_, r) => signed(r.result) },
])
const largest = computed(() => sorted.value.slice(0, TOP).map((r) => ({ label: childName(r), value: Math.max(r.result, 0), text: signed(r.result), href: childHref(r) })))

// ---- Destaques: places where the winner turned, the margin moved most, or a finalist gained very little ----------------------------------------
const cities = computed(() => (contest.value && tab.value === 'cases' ? citiesOf(places.value) : []))
const cityCol = computed(() => ({ key: 'city', label: t('shift.col.city'), fmt: (v, r) => `${cityName(r.state, v)} · ${r.state.toUpperCase()}`, href: (r) => link([r.state, r.city]) }))
const finalistBlocs = computed(() => ['a', 'b'].map((s) => ({ bloc: blocFor(contest.value[s]) })))
const blocFor = (number) => roster.value.find((c) => c.number === number)?.bloc ?? 'N'
const governors = useAsync(() => [key.value, office.value, tab.value, kase.value, base.loading], async ([k, o, tb, cs], q) => {
  if (o !== 'president' || tb !== 'cases' || cs !== 'turned' || base.loading || !shiftOffices(k).includes('governor')) return null
  const rounds = roundsOf(k, 'governor')
  const grain = grainOf(rounds, 'governor')
  await ensureContest(rounds, 'governor', null, grain)
  const run = async ({ sql, params }) => objects(await q(sql, params))
  const [votes, candidates] = await Promise.all([run(votesSql(rounds, 'governor', grain)), run(candidatesSql(rounds, 'governor', null, grain))])
  return markRaw(governorsOf(votes.filter((v) => v.turn === 1), candidates, data.value.spectrum, ELECTIONS[k].year))
})
const turnedRows = computed(() => cities.value.filter((r) => r.turned).map((r) => {
  const g = governors.data?.get(`${r.state}|${r.city}`)
  return { ...r, governor: g, linked: g ? linkedTo(g.bloc, finalistBlocs.value[0], finalistBlocs.value[1]) : null }
}).sort((x, y) => y.result - x.result))
const turnedSummary = computed(() => {
  const rows = turnedRows.value
  const by = (v) => rows.filter((r) => r.linked === v).length
  return { total: rows.length, toA: rows.filter((r) => r.w2 === 'a').length, toB: rows.filter((r) => r.w2 === 'b').length, withA: by('a'), withB: by('b'), others: rows.filter((r) => !r.linked).length }
})
const turnedCols = computed(() => [
  cityCol.value,
  { key: 'a1', label: t('shift.col.first', { name: names.value.a }), num: true, fmt: int }, { key: 'a2', label: t('shift.col.second', { name: names.value.a }), num: true, fmt: int },
  { key: 'b1', label: t('shift.col.first', { name: names.value.b }), num: true, fmt: int }, { key: 'b2', label: t('shift.col.second', { name: names.value.b }), num: true, fmt: int },
  ...(governors.data ? [{ key: 'governor', label: t('shift.col.governor'), fmt: (g) => (g ? `${g.name} · ${g.party} · ${t(`spectrum.bloc.${g.bloc}`)}` : '–') }, { key: 'linked', label: t('shift.col.linked'), fmt: (v) => (v ? names.value[v] : t('shift.neither')) }] : []),
])
const margin = (a, b) => (a + b ? (a - b) / (a + b) : 0)
const bigRows = computed(() => cities.value.filter((r) => r.a2 + r.b2 >= BIG).map((r) => ({ ...r, swing: margin(r.a2, r.b2) - margin(r.a1, r.b1) })).sort((x, y) => Math.abs(y.swing) - Math.abs(x.swing)).slice(0, TOP))
const bigCols = computed(() => [
  cityCol.value, { key: 'm1', label: t('shift.col.margin1'), num: true, fmt: (_, r) => signed(100 * margin(r.a1, r.b1), 1) }, { key: 'm2', label: t('shift.col.margin2'), num: true, fmt: (_, r) => signed(100 * margin(r.a2, r.b2), 1) },
  { key: 'swing', label: t('shift.col.swing'), num: true, fmt: (v) => signed(100 * v, 1) }, { key: 'result', label: t('shift.col.result'), num: true, fmt: (v) => signed(v) },
])
const who = computed(() => (route.value.params.get('who') === 'b' ? 'b' : 'a'))
const smallRows = computed(() => (contest.value && tab.value === 'cases' && kase.value === 'small'
  ? places.value.map((p) => ({ ...p, d: { a: p[2].a - p[1].a, b: p[2].b - p[1].b } })).filter((u) => u.d[who.value] >= 0 && u.d[who.value] <= SMALL).sort((x, y) => x.d[who.value] - y.d[who.value]) : []))
const smallCounts = computed(() => Array.from({ length: SMALL + 1 }, (_, v) => smallRows.value.filter((u) => u.d[who.value] === v).length))
const smallCols = computed(() => [
  { key: 'city', label: t('shift.col.zone'), fmt: (v, r) => `${cityName(r.state, v)} · ${r.state.toUpperCase()}${r.zone ? ` · ${t('shift.zone', { zone: r.zone })}` : ''}`, href: (r) => link([r.state, r.city]) },
  { key: 'a1', label: t('shift.col.first', { name: names.value.a }), num: true, fmt: (_, r) => int(r[1].a) }, { key: 'a2', label: t('shift.col.second', { name: names.value.a }), num: true, fmt: (_, r) => int(r[2].a) }, { key: 'da', label: t('shift.col.delta', { name: names.value.a }), num: true, fmt: (_, r) => signed(r.d.a) },
  { key: 'b1', label: t('shift.col.first', { name: names.value.b }), num: true, fmt: (_, r) => int(r[1].b) }, { key: 'b2', label: t('shift.col.second', { name: names.value.b }), num: true, fmt: (_, r) => int(r[2].b) }, { key: 'db', label: t('shift.col.delta', { name: names.value.b }), num: true, fmt: (_, r) => signed(r.d.b) },
])
const caseItems = computed(() => CASES.map((id) => ({ value: id, label: t(`shift.case.${id}`) })))
const whoItems = computed(() => ['a', 'b'].map((id) => ({ value: id, label: names.value[id] })))
</script>

<template lang="pug">
h1 {{ title }}
p.muted {{ t('shift.lead') }}
.cluster
  ButtonGroup(v-if="offices.length > 1" :label="t('common.office')" :items="officeItems" :value="office" @change="pickOffice")
  Field(v-if="data && states.length > 1" :label="t('common.state')")
    select(:value="args[0] ?? ''" @change="pickState")
      option(value="") {{ depth === 1 ? '–' : t('common.brazil') }}
      option(v-for="s in states" :key="s" :value="s") {{ stateTitle(s) }}
  Field(v-if="data && args[0] && cityOptions.length > 1" :label="t('common.city')")
    select(:value="args[1] ?? ''" @change="pickCity")
      option(value="") {{ t('common.all') }}
      option(v-for="[c, n] in cityOptions" :key="c" :value="c") {{ n }}
Notice(v-if="base.error" kind="danger") {{ base.error.message }}
p.muted(v-else-if="base.loading || !data" role="status") {{ t('shift.loading', { done: int(progress.done), all: int(progress.all) }) }}
Panel(v-else-if="indexed" :title="t(`shift.index.${office}`)" :state="base" :election="key" wide)
  p.muted {{ t('shift.index.note') }}
  DataTable(:columns="contestCols" :rows="contestRows")
Notice(v-else-if="missing" kind="note") {{ t('shift.missing') }}
template(v-else)
  Panel(:title="t('shift.summary')" :state="base" :election="key" wide)
    .cluster
      Stat(v-for="s in stats" :key="s[1]" :value="s[0]" :label="s[1]")
    p(v-if="answer") {{ answer }}
    p.muted(v-if="gapNote") {{ gapNote }}
  Tabs(:items="tabItems" :label="t('shift.tabs')")
  .grid-auto
    template(v-if="tab === 'votes'")
      Panel(v-if="estimation" :title="t('shift.flow.title')" :state="base" :election="key" wide)
        p.muted {{ t('shift.flow.note') }}
        Notice(v-if="estimation.thin" kind="note") {{ t('shift.thin') }}
        Legend(:items="legend")
        .table-wrap(tabindex="0" role="region" :aria-label="t('shift.flow.title')")
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
                  span.muted {{ pct(g.share[0], 0) }}
                td.num
                  | {{ int(g.to[1]) }}
                  span.muted {{ pct(g.share[1], 0) }}
        p.muted {{ fitNote }}
      Notice(v-else kind="note") {{ t('shift.noEstimate') }}
      Panel(v-if="supportRows.length" :title="t('shift.support.title')" :state="base" :election="key")
        p.muted {{ t('shift.support.note') }}
        DataTable(:columns="supportCols" :rows="supportRows")
      Panel(v-if="complete" :title="t('shift.account.title')" :state="base" :election="key")
        p.muted {{ t('shift.account.note', { a: names.a, b: names.b }) }}
        DataTable(:columns="poolCols" :rows="poolRows")
      Notice(v-else kind="note") {{ t('shift.partial') }}
    template(v-else-if="tab === 'places'")
      Panel(:title="t(`shift.children.${level}`)" :state="base" :election="key" wide)
        p.muted(v-if="!children.length") {{ t('shift.noChildren') }}
        DataTable(v-else :columns="cols" :rows="sorted" :sort="sc" @sort="onSort")
      Panel(v-if="children.length > 1" :title="t('shift.largest')" :state="base" :election="key")
        p.muted {{ t('shift.largestNote') }}
        BarList(:items="largest")
    template(v-else)
      ButtonGroup(:label="t('shift.cases')" :items="caseItems" :value="kase" @change="(v) => setParam('case', v === CASES[0] ? null : v)")
      Panel(v-if="kase === 'turned'" :title="t('shift.case.turned')" :state="base" :election="key" wide)
        p {{ t('shift.turnedSummary', { total: int(turnedSummary.total), a: names.a, b: names.b, toA: int(turnedSummary.toA), toB: int(turnedSummary.toB) }) }}
        p(v-if="governors.data") {{ t('shift.turnedGovernors', { a: names.a, b: names.b, withA: int(turnedSummary.withA), withB: int(turnedSummary.withB), others: int(turnedSummary.others) }) }}
        p.muted(v-if="governors.data") {{ t('shift.turnedNote') }}
        DataTable(:columns="turnedCols" :rows="turnedRows")
      Panel(v-else-if="kase === 'big'" :title="t('shift.bigTitle', { top: TOP })" :state="base" :election="key" wide)
        p.muted {{ t('shift.bigNote', { votes: int(BIG) }) }}
        DataTable(:columns="bigCols" :rows="bigRows")
      Panel(v-else :title="t('shift.smallTitle', { max: SMALL })" :state="base" :election="key" wide)
        p.muted {{ t('shift.smallNote', { max: SMALL }) }}
        ButtonGroup(:label="t('shift.who')" :items="whoItems" :value="who" @change="(v) => setParam('who', v === 'a' ? null : v)")
        p {{ t('shift.smallTotal', { n: int(smallRows.length), name: names[who], max: SMALL }) }}
        ColumnChart(v-if="smallRows.length" :label="t('shift.smallTitle', { max: SMALL })" :values="smallCounts" :labels="smallCounts.map((_, v) => String(v))" :height="220" :tick="int" :fmt="int")
        DataTable(:columns="smallCols" :rows="smallRows.slice(0, 200)")
  details.panel
    summary {{ t('shift.limits.title') }}
    p {{ t('shift.limits.secret') }}
    p {{ t('shift.limits.model') }}
</template>
