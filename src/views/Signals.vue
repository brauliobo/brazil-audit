<script setup vapor>
import { computed } from 'vue'
import { route, href, go } from '../router'
import { ELECTIONS, inElection } from '../model'
import { electionLabel, stateName, stateTitle } from '../labels'
import { t } from '../i18n'
import { ensureSmall, ensureState, statesIn } from '../data'
import { useAsync } from '../use'
import { objects } from '../db'
import { int, num, pct } from '../format'
import { SIGNALS, TABS, bit, FIRST_HOUR } from '../signals'
import Panel from '../components/Panel.vue'
import Field from '../components/Field.vue'
import Notice from '../components/Notice.vue'
import Tabs from '../components/Tabs.vue'
import ColumnChart from '../components/ColumnChart.vue'
import Scatter from '../components/Scatter.vue'
import DataTable from '../components/DataTable.vue'
import SignalSection from '../components/SignalSection.vue'

const BY_CHANCE = 0.00135 // one-sided tail of a z-score of 3: the share of sections a perfectly ordinary election would still flag
const LIST = 20

const year = computed(() => route.value.election)
const cfg = computed(() => ELECTIONS[year.value])
const args = computed(() => route.value.args)
const state = computed(() => args.value[0] ?? null)
const isSection = computed(() => args.value.length === 4)
const tabs = computed(() => (cfg.value.hasTimes ? TABS : TABS.slice(0, 1)))
const tab = computed(() => (tabs.value.includes(route.value.params.get('tab')) ? route.value.params.get('tab') : 'abstention'))

const base = useAsync(() => [year.value, state.value], async ([y, s]) => {
  if (!ELECTIONS[y].hasSignals) return null
  await ensureSmall(y, 'sgz', 'sgf')
  if (s) await ensureState('sg', y, s)
  return true
})

// A panel's query runs only while its tab is open: `r(sql, params)` returns row objects, params default to [state].
const use = (only, run) => useAsync(() => [year.value, state.value, tab.value, base.loading], async ([y, s, tb], q) =>
  !ELECTIONS[y].hasSignals || base.loading || (only && tb !== only) ? null : run(y, s, async (sql, params = [s]) => objects(await q(sql, params))))
const scope = `($1::text is null or state = $1)`
const crit = `((fl & 1) + ((fl >> 1) & 1) + ((fl >> 2) & 1))`

const head = use(null, async (y, s, r) => {
  const [{ sections }] = await r(`select sum(sections)::int sections from sgz where ${inElection(y)} and ${scope}`)
  const [f] = await r(`select count(*)::int one, count(*) filter (where n >= 2)::int two, count(*) filter (where n = 3)::int three,
    count(*) filter (where (fl & 1) > 0)::int abs, count(*) filter (where (fl & 4) > 0)::int man from (select fl, ${crit} n from sgf where ${inElection(y)} and ${scope}) x`)
  return { sections, ...f, chance: Math.round(sections * BY_CHANCE) }
})

// ---- abstention ------------------------------------------------------------------------------------------------------------
const byState = use('abstention', async (y, _s, r) => {
  const rows = await r(`select state, 1 - sum(comp)::float8 / sum(aptos) rate from sgz where ${inElection(y)} group by state order by state`, [])
  const [{ rate }] = await r(`select 1 - sum(comp)::float8 / sum(aptos) rate from sgz where ${inElection(y)}`, [])
  return { values: rows.map((x) => 100 * x.rate), labels: rows.map((x) => x.state.toUpperCase()), line: rows.map(() => 100 * rate), mean: rate }
})
const zones = use('abstention', async (y, s, r) => {
  const rows = await r(`select floor((1 - comp::float8 / aptos) * 50)::int bin, count(*)::int n from sgz where ${inElection(y)} and ${scope} and aptos >= 500 group by 1 order by 1`)
  const top = Math.max(...rows.map((x) => x.bin), 0)
  return { values: Array.from({ length: top + 1 }, (_, i) => rows.find((x) => x.bin === i)?.n ?? 0), labels: Array.from({ length: top + 1 }, (_, i) => `${2 * i}%`), total: rows.reduce((n, x) => n + x.n, 0) }
})
const SIZES = 60
const funnel = use('abstention', async (y, s, r) => {
  if (!s) return { none: true }
  const secs = await r(`select aptos, comp, fl & 1 flagged from sg where ${inElection(y)} and state = $1 and aptos > 0`)
  const [absent, roll] = secs.reduce(([a, n], x) => [a + x.aptos - x.comp, n + x.aptos], [0, 0])
  const [points, marks] = [[], []]
  for (const x of secs) (x.flagged ? marks : points).push([x.aptos, 100 * (1 - x.comp / x.aptos)])
  const [p, big] = [absent / roll, secs.reduce((m, x) => Math.max(m, x.aptos), 0)]
  const sizes = Array.from({ length: SIZES }, (_, i) => Math.exp(Math.log(50) + (Math.log(big) - Math.log(50)) * i / (SIZES - 1)))
  return { points, marks, curves: [-3, -2, 2, 3].map((k) => sizes.map((n) => [n, 100 * (p + k * Math.sqrt(p * (1 - p) / n))])), mean: p }
})
const lowAbstention = use('abstention', (y, s, r) => r(`select state, city, zone, section, aptos, comp, zabs, 1 - comp::float8 / aptos rate from sgf where ${inElection(y)} and ${scope} and (fl & 1) > 0 order by zabs limit ${LIST}`))

// ---- late votes ------------------------------------------------------------------------------------------------------------
const hourly = (y, s, r) => r(`select sum(a)::int hv, sum(m)::int hm, sum(n)::int hn from sgz, unnest(hv, hm, hn) with ordinality t(a, m, n, i) where ${inElection(y)} and ${scope} group by i order by i`).then((rows) => {
  const [hv, hm, hn] = ['hv', 'hm', 'hn'].map((k) => rows.map((x) => x[k]))
  const first = Math.max(hv.findIndex((v) => v > 0), 0)
  const last = hv.findLastIndex((v) => v > 0)
  const cut = (xs) => xs.slice(first, last + 1)
  return { hv: cut(hv), hm: cut(hm), hn: cut(hn), labels: cut(hv).map((_, i) => `${FIRST_HOUR + first + i}h`), total: hv.reduce((a, b) => a + b, 0), first }
})
const lateHours = use('late', (y, s, r) => hourly(y, s, r).then((h) => ({ ...h, values: h.hv.map((v) => 100 * v / h.total) })))
const lateList = use('late', (y, s, r) => r(`select state, city, zone, section, v, lt, lt::float8 / v share, dlate from sgf where ${inElection(y)} and ${scope} and (fl & 2) > 0 order by lt::float8 / v desc, lt desc limit ${LIST}`))

// ---- voters released without a fingerprint ----------------------------------------------------------------------------------
const nofpHours = use('nofp', (y, s, r) => hourly(y, s, r).then((h) => ({ ...h,
  values: h.hv.map((v, i) => (v ? 100 * (h.hm[i] + h.hn[i]) / v : 0)), line: h.hv.map((v, i) => (v ? 100 * h.hm[i] / v : 0)),
  share: (h.hm.reduce((a, b) => a + b, 0) + h.hn.reduce((a, b) => a + b, 0)) / h.total, manual: h.hm.reduce((a, b) => a + b, 0) / h.total })))
const manualList = use('nofp', (y, s, r) => r(`select state, city, zone, section, man, bio + man tried, man::float8 / nullif(bio + man, 0) share, run, zman from sgf where ${inElection(y)} and ${scope} and (fl & 4) > 0 order by zman desc limit ${LIST}`))

// ---- sections that meet several criteria ------------------------------------------------------------------------------------
const byCount = use('cross', (y, s, r) => r(`select state, count(*)::int one, count(*) filter (where n >= 2)::int two, count(*) filter (where n = 3)::int three
  from (select state, ${crit} n from sgf where ${inElection(y)} and ${scope}) x group by state order by three desc, two desc, one desc`))
const crossList = use('cross', (y, s, r) => r(`select state, city, zone, section, fl, ${crit} n, 1 - comp::float8 / aptos rate, lt::float8 / nullif(v, 0) late, man::float8 / nullif(bio + man, 0) manual
  from sgf where ${inElection(y)} and ${scope} and ${crit} >= 2 order by n desc, zabs limit ${LIST * 2}`))

// ---- table columns ----------------------------------------------------------------------------------------------------------
const secHref = (r) => href(year.value, 'signals', [r.state, r.city, r.zone, r.section])
const where = (r) => t('signals.place', { section: r.section, zone: r.zone, city: r.city, state: r.state.toUpperCase() })
const sectionCol = computed(() => ({ key: 'section', label: t('common.section'), fmt: (_, r) => where(r), href: secHref }))
const col = (key, label, fmt = int) => ({ key, label: t(label), num: true, fmt })
const named = (r) => SIGNALS.slice(0, 3).filter((id) => r.fl & bit(id)).map((id) => t(`signals.short.${id}`)).join(' · ')
const lowCols = computed(() => [sectionCol.value, col('aptos', 'signals.col.voters'), col('rate', 'signals.col.abstention', (v) => pct(v, 1)), col('zabs', 'signals.col.z', (v) => num(v, 1))])
const lateCols = computed(() => [sectionCol.value, col('v', 'signals.col.votes'), col('lt', 'signals.col.late'), col('share', 'signals.col.lateShare', (v) => pct(v, 0)), col('dlate', 'signals.col.later', (v) => (v == null ? '–' : t('signals.minutes', { n: int(v) })))])
const manualCols = computed(() => [sectionCol.value, col('man', 'signals.col.manual'), col('tried', 'signals.col.tried'), col('share', 'signals.col.manualShare', (v) => pct(v, 0)), col('run', 'signals.col.run'), col('zman', 'signals.col.z', (v) => num(v, 1))])
const stateCols = computed(() => [{ key: 'state', label: t('common.state'), fmt: (v) => v.toUpperCase(), href: (r) => href(year.value, 'signals', [r.state], { tab: 'cross' }) }, col('one', 'signals.col.one'), col('two', 'signals.col.two'), col('three', 'signals.col.three')])
const crossCols = computed(() => [sectionCol.value, { key: 'fl', label: t('signals.col.criteria'), fmt: (_, r) => named(r) }, col('rate', 'signals.col.abstention', (v) => pct(v, 1)), col('late', 'signals.col.lateShare', (v) => (v == null ? '–' : pct(v, 0))), col('manual', 'signals.col.manualShare', (v) => (v == null ? '–' : pct(v, 0)))])

const tabItems = computed(() => tabs.value.map((id) => ({ href: href(year.value, 'signals', args.value, { tab: id === 'abstention' ? null : id }), label: t(`signals.tab.${id}`), current: id === tab.value })))
const pickState = (e) => go(href(year.value, 'signals', e.target.value ? [e.target.value] : [], { tab: tab.value === 'abstention' ? null : tab.value }))
const place = computed(() => (state.value ? stateName(state.value) : t('common.brazil')))
const percent = (v) => `${num(v, 1)}%`
</script>

<template lang="pug">
h1 {{ t('signals.title', { place, election: electionLabel(year) }) }}
p.muted(v-if="!cfg.hasSignals") {{ t('signals.unavailable') }}
template(v-else)
  Notice(kind="warning") {{ t('signals.caution') }}
  SignalSection(v-if="isSection" :year="year" :args="args")
  template(v-else)
    .cluster
      Field(:label="t('common.state')")
        select(:value="state ?? ''" @change="pickState")
          option(value="") {{ t('common.brazil') }}
          option(v-for="s in statesIn('sg', year)" :key="s" :value="s" :selected="s === state") {{ stateTitle(s) }}
    Panel(:title="t('signals.summary')" :state="head" :election="year" wide)
      ul
        li {{ t('signals.headline', { flagged: int(head.data.one), sections: int(head.data.sections), share: pct(head.data.one / head.data.sections, 2) }) }}
        li(v-if="cfg.hasTimes") {{ t('signals.several', { two: int(head.data.two), three: int(head.data.three) }) }}
        li(v-if="cfg.hasTimes") {{ t('signals.chance', { expected: int(head.data.chance), abs: int(head.data.abs), man: int(head.data.man) }) }}
        li(v-else) {{ t('signals.chanceAbs', { expected: int(head.data.chance), abs: int(head.data.abs) }) }}
      p.muted {{ t('signals.how') }}
    Tabs(v-if="tabs.length > 1" :items="tabItems" :label="t('signals.tabs')")
    .grid-auto
      template(v-if="tab === 'abstention'")
        Panel(:title="t('signals.byState')" :state="byState" :election="year" wide)
          p.muted {{ t('signals.byStateNote', { mean: pct(byState.data.mean, 1) }) }}
          ColumnChart(:label="t('signals.byState')" :values="byState.data.values" :labels="byState.data.labels" :line="byState.data.line" :height="260" :fmt="percent")
        Panel(:title="t('signals.zones')" :state="zones" :election="year")
          p.muted {{ t('signals.zonesNote', { zones: int(zones.data.total) }) }}
          ColumnChart(:label="t('signals.zones')" :values="zones.data.values" :labels="zones.data.labels" :height="240" :tick="int" :fmt="(v) => t('signals.zonesCount', { count: v })")
        Panel(:title="t('signals.funnel')" :state="funnel" :election="year" wide)
          p.muted(v-if="funnel.data.none") {{ t('signals.pickState') }}
          template(v-else)
            p.muted {{ t('signals.funnelNote', { mean: pct(funnel.data.mean, 1) }) }}
            Scatter(:points="funnel.data.points" :marks="funnel.data.marks" :curves="funnel.data.curves" :x-label="t('signals.col.voters')" :y-label="t('signals.col.abstention')")
        Panel(:title="t('signals.lowAbstention')" :state="lowAbstention" :election="year" wide)
          p.muted {{ t('signals.lowAbstentionNote') }}
          DataTable(:columns="lowCols" :rows="lowAbstention.data")
      template(v-else-if="tab === 'late'")
        Panel(:title="t('signals.lateHours')" :state="lateHours" :election="year" wide)
          p.muted {{ t('signals.lateHoursNote') }}
          ColumnChart(:label="t('signals.lateHours')" :values="lateHours.data.values" :labels="lateHours.data.labels" :height="260" :fmt="percent")
        Panel(:title="t('signals.lateList')" :state="lateList" :election="year" wide)
          p.muted {{ t('signals.lateListNote') }}
          DataTable(:columns="lateCols" :rows="lateList.data")
      template(v-else-if="tab === 'nofp'")
        Panel(:title="t('signals.nofpHours')" :state="nofpHours" :election="year" wide)
          p.muted {{ t('signals.nofpHoursNote', { all: pct(nofpHours.data.share, 1), manual: pct(nofpHours.data.manual, 1) }) }}
          ColumnChart(:label="t('signals.nofpHours')" :values="nofpHours.data.values" :labels="nofpHours.data.labels" :line="nofpHours.data.line" :height="260" :fmt="percent")
        Panel(:title="t('signals.manualList')" :state="manualList" :election="year" wide)
          p.muted {{ t('signals.manualListNote') }}
          DataTable(:columns="manualCols" :rows="manualList.data")
      template(v-else)
        Panel(:title="t('signals.byCount')" :state="byCount" :election="year")
          p.muted {{ t('signals.byCountNote') }}
          DataTable(:columns="stateCols" :rows="byCount.data")
        Panel(:title="t('signals.crossList')" :state="crossList" :election="year" wide)
          p.muted {{ t('signals.crossListNote') }}
          DataTable(:columns="crossCols" :rows="crossList.data")
</template>
