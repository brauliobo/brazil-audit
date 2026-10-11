<script setup vapor>
import { computed } from 'vue'
import { href } from '../router'
import { ELECTIONS, inElection } from '../model'
import { t } from '../i18n'
import { ensureSmall, ensureState } from '../data'
import { useAsync } from '../use'
import { objects } from '../db'
import { int, pct } from '../format'
import { SIGNALS, bit, FIRST_HOUR } from '../signals'
import Panel from './Panel.vue'
import ColumnChart from './ColumnChart.vue'
import DataTable from './DataTable.vue'

// One section against its neighbours: the criteria it meets, the same rates for the school, zone, city, state and country, its hourly
// profile against the city's, and the other sections of its school. Props: the election key and the route args [state, city, zone, section].
const props = defineProps({ year: String, args: Array })
const hasLogs = computed(() => ELECTIONS[props.year].hasTimes)
const AGG = 'sum(aptos)::int aptos, sum(comp)::int comp, sum(v)::int v, sum(lt)::int lt, sum(bio)::int bio, sum(man)::int man, sum(nor)::int nor'
const BY = { school: 'school = $5', zone: 'zone = $3', city: 'true' }

const detail = useAsync(() => [props.year, props.args], async ([y, [state, city, zone, section]], q) => {
  await ensureSmall(y, 'sgz')
  await ensureState('sg', y, state)
  const rows = async (sql, params) => objects(await q(sql, params))
  const e = inElection(y)
  const [row] = await rows(`select * from sg where ${e} and state = $1 and city = $2 and zone = $3 and section = $4`, [state, city, zone, section])
  if (!row) return { missing: true }
  const params = [state, city, zone, section, row.school]
  const agg = (id, from, filter) => `select '${id}' id, ${AGG} from ${from} where ${e} and ${filter}`
  const scopes = await rows([
    agg('section', 'sg', 'state = $1 and city = $2 and zone = $3 and section = $4'),
    ...Object.entries(BY).map(([id, filter]) => agg(id, 'sg', `state = $1 and city = $2 and ${filter}`)),
    agg('state', 'sgz', 'state = $1'),
    agg('country', 'sgz', 'true'),
  ].join(' union all '), params)
  const school = await rows(`select zone, section, aptos, comp, v, lt, bio, man, nor, fl from sg where ${e} and state = $1 and city = $2 and school = $3 order by (fl & 7) desc, zone, section limit 30`, [state, city, row.school])
  const cityHours = hasLogs.value && row.hv ? (await rows(`select sum(x)::int h from sg, unnest(hv) with ordinality t(x, i) where ${e} and state = $1 and city = $2 and v > 0 group by i order by i`, [state, city])).map((r) => r.h) : null
  return { row: { ...row, hv: row.hv && JSON.parse(row.hv) }, scopes: ['section', 'school', 'zone', 'city', 'state', 'country'].map((id) => scopes.find((s) => s.id === id)), school, cityHours }
})

const SCOPE_ORDER = computed(() => detail.data?.scopes ?? [])
const rate = (n, d) => (d ? n / d : null)
const cell = (v) => (v == null ? '–' : pct(v, 1))
const compare = computed(() => SCOPE_ORDER.value.map((s) => ({ ...s, abstention: rate(s.aptos - s.comp, s.aptos), late: rate(s.lt, s.v), manual: rate(s.man, s.bio + s.man), nofp: rate(s.man + s.nor, s.v) })))
const compareCols = computed(() => [
  { key: 'id', label: t('signals.compare'), fmt: (v) => t(`signals.scope.${v}`) },
  { key: 'aptos', label: t('signals.col.voters'), num: true, fmt: int },
  { key: 'abstention', label: t('signals.col.abstention'), num: true, fmt: cell },
  ...(hasLogs.value ? [
    { key: 'late', label: t('signals.col.lateShare'), num: true, fmt: cell },
    { key: 'manual', label: t('signals.col.manualShare'), num: true, fmt: cell },
    { key: 'nofp', label: t('signals.col.nofpShare'), num: true, fmt: cell },
  ] : []),
])

const fired = computed(() => SIGNALS.filter((id) => detail.data.row.fl & bit(id)))
const hours = computed(() => {
  const { row, cityHours } = detail.data
  if (!cityHours || !row.v) return null
  const total = cityHours.reduce((a, b) => a + b, 0)
  const first = Math.max(Math.min(row.hv.findIndex((v) => v > 0), cityHours.findIndex((v) => v > 0)), 0)
  const last = Math.max(row.hv.findLastIndex((v) => v > 0), cityHours.findLastIndex((v) => v > 0))
  return { values: row.hv.slice(first, last + 1), line: cityHours.slice(first, last + 1).map((v) => row.v * v / total), labels: row.hv.slice(first, last + 1).map((_, i) => `${FIRST_HOUR + first + i}h`) }
})

const at = (r) => [props.args[0], props.args[1], r.zone, r.section]
const schoolCols = computed(() => [
  { key: 'section', label: t('common.section'), fmt: (v, r) => t('signals.zoneSection', { zone: r.zone, section: v }), href: (r) => href(props.year, 'signals', at(r)) },
  { key: 'aptos', label: t('signals.col.voters'), num: true, fmt: int },
  { key: 'comp', label: t('signals.col.abstention'), num: true, fmt: (v, r) => cell(rate(r.aptos - v, r.aptos)) },
  ...(hasLogs.value ? [
    { key: 'lt', label: t('signals.col.lateShare'), num: true, fmt: (v, r) => cell(rate(v, r.v)) },
    { key: 'man', label: t('signals.col.manualShare'), num: true, fmt: (v, r) => cell(rate(v, r.bio + r.man)) },
  ] : []),
  { key: 'fl', label: t('signals.col.signals'), num: true, fmt: (v) => int(SIGNALS.filter((id) => v & bit(id)).length) },
])
</script>

<template lang="pug">
Panel(:title="t('signals.sectionTitle', { section: args[3], zone: args[2], city: args[1], state: args[0].toUpperCase() })" :state="detail" :election="year" wide)
  p(v-if="detail.data.missing") {{ t('signals.noSection') }}
  template(v-else)
    .cluster
      a(:href="href(year, 'drill', args)") {{ t('signals.seeResults') }}
      a(v-if="hasLogs" :href="href(year, 'time', args)") {{ t('signals.seeTimes') }}
      a(v-if="ELECTIONS[year].raw.logpack" :href="href(year, 'logs', args)") {{ t('logs.seeLogs') }}
    p(v-if="!fired.length") {{ t('signals.noneMet') }}
    ul(v-else)
      li(v-for="id in fired" :key="id")
        strong {{ t(`signals.short.${id}`) }}
        |  — {{ t(`signals.about.${id}`) }}
    h3 {{ t('signals.compare') }}
    DataTable(:columns="compareCols" :rows="compare")
    template(v-if="hours")
      h3 {{ t('signals.hourly') }}
      p.muted {{ t('signals.hourlyNote') }}
      ColumnChart(:label="t('signals.hourly')" :values="hours.values" :labels="hours.labels" :line="hours.line" :height="240" :tick="int" :fmt="(v) => t('common.votes', { count: Math.round(v) })")
    h3 {{ t('signals.school') }}
    DataTable(:columns="schoolCols" :rows="detail.data.school")
</template>
