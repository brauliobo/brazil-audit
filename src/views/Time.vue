<script setup vapor>
import { computed } from 'vue'
import { route, href, go, setParam } from '../router'
import { ELECTIONS, BUCKET, collate, inElection } from '../model'
import { electionLabel, stateName, stateTitle } from '../labels'
import { t } from '../i18n'
import { ensureScope, ensureSmall, statesIn } from '../data'
import { useAsync } from '../use'
import { objects } from '../db'
import { clock, int, num } from '../format'
import Panel from '../components/Panel.vue'
import Field from '../components/Field.vue'
import ColumnChart from '../components/ColumnChart.vue'
import DataTable from '../components/DataTable.vue'

const year = computed(() => route.value.election)
const cfg = computed(() => ELECTIONS[year.value])
const args = computed(() => route.value.args)
const [state, city] = [computed(() => args.value[0] ?? null), computed(() => args.value[1] ?? null)]
const isSection = computed(() => args.value.length === 4)
const brt = computed(() => route.value.params.get('clock') !== 'local')
const rank = computed(() => route.value.params.get('rank') ?? 'fast')
const rows = async (q, sql, params) => objects(await q(sql, params))

// Scope data: the tiny city rollups are always loaded; section rows (and their results) only for the selected UF.
const base = useAsync(() => [year.value, state.value], async ([y, s]) => {
  await ensureSmall(y, 'vtc')
  if (s) await Promise.all([ensureScope('vt', y, s), ensureScope('rdv', y, s)])
  return true
})
const waiting = () => base.loading

const cities = useAsync(() => [year.value, state.value, base.loading], async ([y, s], q) => (waiting() || !s ? [] : rows(q, `select city from vtc where state = $1 and ${inElection(y)} order by ${collate('city')}`, [s])))

// votes per 10-minute bucket; bucket index shifted by 6 per hour to Brasilia time when `brt` (tz is the city's offset estimate)
const shift = (b) => (b ? '(ord - 1) - 6 * tz' : '(ord - 1)')
const curve = useAsync(() => [year.value, args.value, brt.value, base.loading], async ([y, a, b], q) => {
  if (waiting()) return null
  const found = isSection.value
    ? await rows(q, `select ${shift(b)} bucket, sum(v)::int votes from vt s join vtc using (election, turn, state, city), unnest(s.b) with ordinality t(v, ord)
        where ${inElection(y)} and state = $1 and city = $2 and zone = $3 and section = $4 group by 1 order by 1`, a)
    : await rows(q, `select ${shift(b)} bucket, sum(v)::int votes from vtc, unnest(b) with ordinality t(v, ord)
        where ${inElection(y)} and ($1::text is null or state = $1) and ($2::text is null or city = $2) group by 1 order by 1`, [a[0] ?? null, a[1] ?? null])
  const first = found.find((r) => r.votes > 0)?.bucket ?? 0
  const last = found.findLast((r) => r.votes > 0)?.bucket ?? 0
  const votes = Array.from({ length: last - first + 1 }, (_, i) => found.find((r) => r.bucket === first + i)?.votes ?? 0)
  const labels = votes.map((_, i) => clock(BUCKET.start + (first + i) * BUCKET.step))
  return { votes, labels, total: votes.reduce((t, v) => t + v, 0) }
})

const summary = useAsync(() => [year.value, args.value, base.loading], async ([y, a], q) => {
  if (waiting()) return null
  const [r] = await rows(q, `select count(*) cities, sum(sections) sections, sum(n) votes, min(tz) tz_min, max(tz) tz_max from vtc
    where ${inElection(y)} and ($1::text is null or state = $1) and ($2::text is null or city = $2)`, [a[0] ?? null, a[1] ?? null])
  return r
})

const RANKS = {
  fast: ['p10 asc', 'n >= 60'],
  regular: ['(p90 - p10)::float8 / nullif(med, 0) asc', 'n >= 60 and med > 0'],
  gap: ['maxgap desc', 'n >= 30'],
  diff: ['abs(n - total) desc', 'total is not null'],
}
const paced = useAsync(() => [year.value, state.value, city.value, rank.value, base.loading], async ([y, s, c, r], q) => {
  if (waiting()) return null
  const [order, where] = RANKS[r]
  return rows(q, `with t as (select v.*, s.nominal + s.blank + s.nul total from vt v left join sec s
      on s.election = v.election and s.turn = v.turn and s.state = v.state and s.city = v.city and s.zone = v.zone and s.section = v.section and s.model = v.model and s.office = 1
      where ${inElection(y, 'v')} and ($1::text is null or v.state = $1) and ($2::text is null or v.city = $2))
    select state, city, zone, section, n, total, n - total diff, first, last, p10, med, p90, maxgap from t where ${where} order by ${order} limit 20`, [s, c])
})

const go2 = (a) => go(href(year.value, 'time', a, { clock: brt.value ? null : 'local' }))
const pickState = (e) => go2(e.target.value ? [e.target.value] : [])
const pickCity = (e) => go2(e.target.value ? [state.value, e.target.value] : [state.value])
const pick = (key, e) => setParam(key, e.target.value)
const secLink = (r) => href(year.value, 'time', [r.state, r.city, r.zone, r.section], { clock: brt.value ? null : 'local' })
const sec = (v) => (v == null ? '–' : t('units.seconds', { n: int(v) }))
const cols = computed(() => [
  { key: 'state', label: t('common.state'), fmt: (v) => v.toUpperCase() },
  { key: 'city', label: t('common.city') },
  { key: 'zone', label: t('common.zone') },
  { key: 'section', label: t('common.section'), href: secLink },
  { key: 'n', label: t('time.events'), num: true, fmt: int },
  { key: 'total', label: t('time.ballots'), num: true, fmt: int },
  { key: 'first', label: t('time.first'), num: true, fmt: clock },
  { key: 'last', label: t('time.last'), num: true, fmt: clock },
  { key: 'p10', label: 'p10', num: true, fmt: sec },
  { key: 'med', label: t('time.median'), num: true, fmt: sec },
  { key: 'p90', label: 'p90', num: true, fmt: sec },
  { key: 'maxgap', label: t('time.maxGap'), num: true, fmt: sec },
])
const place = computed(() => {
  if (isSection.value) return t('time.placeSection', { section: args.value[3], zone: args.value[2], city: args.value[1], state: args.value[0].toUpperCase() })
  if (city.value) return t('time.placeCity', { city: city.value, state: state.value.toUpperCase() })
  return state.value ? stateName(state.value) : t('common.brazil')
})
const clockNote = computed(() => (brt.value ? t('time.clockConverted', { min: summary.data.tz_min, max: summary.data.tz_max }) : t('time.clockRecorded')))
</script>

<template lang="pug">
h1 {{ t('time.title', { place, election: electionLabel(year) }) }}
.cluster(v-if="cfg.hasTimes")
  Field(:label="t('common.state')")
    select(:value="state ?? ''" @change="pickState")
      option(value="") {{ t('common.brazil') }}
      option(v-for="s in statesIn('vt', year)" :key="s" :value="s" :selected="s === state") {{ stateTitle(s) }}
  Field(v-if="state && cities.data" :label="t('common.city')")
    select(:value="city ?? ''" @change="pickCity")
      option(value="") {{ t('common.allCities') }}
      option(v-for="c in cities.data" :key="c.city" :value="c.city" :selected="c.city === city") {{ c.city }}
  Field(:label="t('time.clock')")
    select(:value="brt ? 'brt' : 'local'" @change="setParam('clock', $event.target.value === 'brt' ? null : 'local')")
      option(value="brt") {{ t('time.clockBrt') }}
      option(value="local") {{ t('time.clockLocal') }}
  a(v-if="isSection" :href="href(year, 'drill', args)") {{ t('time.seeResults') }}
.muted(v-if="!cfg.hasTimes") {{ t('time.unavailable') }}
.grid-auto(v-else)
  Panel(:title="t('time.curveTitle')" :state="curve" :election="year" wide)
    ColumnChart(:label="t('time.curveTitle')" :values="curve.data.votes" :labels="curve.data.labels" :height="260" :tick="int" :fmt="(v) => t('common.votes', { count: v })")
    p.muted(v-if="summary.data") {{ t('time.summary', { events: int(curve.data.total), sections: int(summary.data.sections), cities: int(summary.data.cities), clock: clockNote }) }}
  Panel(:title="t('time.pace')" :state="paced" :election="year" wide)
    .cluster
      Field(:label="t('time.sortBy')")
        select(:value="rank" @change="pick('rank', $event)")
          option(v-for="k in Object.keys(RANKS)" :key="k" :value="k" :selected="k === rank") {{ t(`time.rank.${k}`) }}
    p.muted {{ t('time.paceNote') }}
    DataTable(:columns="cols" :rows="paced.data")
</template>
