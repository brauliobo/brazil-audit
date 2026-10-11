<script setup vapor>
import { computed, reactive, watch } from 'vue'
import { route, href, go, setParam } from '../router'
import { ELECTIONS, candJoin, collate, fold, inElection } from '../model'
import { electionLabel, officeName, stateTitle } from '../labels'
import { t } from '../i18n'
import { ensure, ensureScope, ensureSmall, ensureState, statesIn } from '../data'
import { useAsync } from '../use'
import { objects } from '../db'
import { bytes, clock, hms, int } from '../format'
import { METHODS, inWindow, loadConfig, loadSection, packsUrl, parseClock } from '../logpack'
import Button from '../components/Button.vue'
import DataTable from '../components/DataTable.vue'
import Field from '../components/Field.vue'
import Notice from '../components/Notice.vue'
import Panel from '../components/Panel.vue'
import SourceBadge from '../components/SourceBadge.vue'

// The log of one ballot-box (urn), read on demand from the published packs (src/logpack.js): who was enabled and when, how, and the other
// lines of the log, for a time window ("around 10:40"). The log never holds what a voter typed: the numbers box only shows the section's RDV tallies.
const PAGE = 50
const SPANS = [5, 10, 30, 60]
const year = computed(() => route.value.election)
const cfg = computed(() => ELECTIONS[year.value])
const args = computed(() => route.value.args)
const params = computed(() => route.value.params)
const isSection = computed(() => args.value.length === 4)
const page = (key) => Number(params.value.get(key) ?? 1) - 1
const slice = (rows, key) => rows.slice(page(key) * PAGE, (page(key) + 1) * PAGE)

const devBase = import.meta.env.DEV && new URLSearchParams(location.search).get('logs') // read once: navigating drops the query
const packs = (key) => import.meta.env.VITE_LOGS_BASE || devBase || packsUrl(key) // another host: VITE_LOGS_BASE at build time, ?logs=<url> in dev

// the form follows the address; submitting writes it back
const form = reactive({ uf: '', city: '', zone: '', section: '', at: '', span: '10', n: '' })
watch(route, ({ args: [uf = '', city = '', zone = '', section = ''], params: p }) => Object.assign(form, { uf, city, zone, section, at: p.get('at') ?? '', span: p.get('span') ?? '10', n: p.get('n') ?? '' }), { immediate: true })
const set = (key, e) => (form[key] = e.target.value)
const padded = (v) => (/^\d+$/.test(v) ? v.padStart(4, '0') : v)
function submit() {
  const where = form.city && form.zone && form.section ? [form.uf, form.city, padded(form.zone), padded(form.section)] : form.city ? [form.uf, form.city] : form.uf ? [form.uf] : []
  go(href(year.value, 'logs', where, { at: form.at, span: form.at && form.span !== '10' ? form.span : null, n: form.n.trim() }))
}
const pickState = (e) => Object.assign(form, { uf: e.target.value, city: '' })

const cities = useAsync(() => [year.value, form.uf], async ([y, uf], q) => {
  await ensureSmall(y, 'vtc')
  return uf ? objects(await q(`select city from vtc where state = $1 and ${inElection(y)} order by ${collate('city')}`, [uf])) : []
})

const sections = useAsync(() => [year.value, args.value], async ([y, a], q) => {
  if (a.length !== 2) return null
  await ensureScope('vt', y, a[0])
  return objects(await q(`select zone, section, n, first, last from vt where ${inElection(y)} and state = $1 and city = $2 order by zone, section`, a))
})

// the city may be written without accents or in lower case: resolve it to the stored name (and fix the address); the log is found by the TSE city code
const view = useAsync(() => [year.value, args.value], async ([y, a], q) => {
  if (a.length !== 4) return null
  await ensure('mun_map')
  const [m] = objects(await q(`select city, tse from mun_map where state = $1 and ${fold('city')} = ${fold('$2::text')} limit 1`, [a[0], a[1]]))
  if (!m) throw new Error(t('errors.notFound'))
  const canon = [a[0], m.city, padded(a[2]), padded(a[3])]
  if (canon.some((x, i) => x !== a[i])) { go(href(y, 'logs', canon, Object.fromEntries(params.value)), { replace: true }); return null }
  return loadSection(await loadConfig(y), packs(y), { uf: a[0], city: m.tse, zone: a[2], section: a[3] })
})

const range = computed(() => {
  const at = parseClock(params.value.get('at'))
  const span = Number(params.value.get('span') ?? 10) * 60
  return at == null ? [null, null] : [at - span, at + span]
})
const shown = computed(() => view.data.urns.map((u) => inWindow(u, ...range.value)))
const voters = computed(() => shown.value.flatMap((u, i) => u.voters.map((v) => ({ ...v, urn: i + 1, dur: v.done - v.enabled }))))
const events = computed(() => shown.value.flatMap((u, i) => u.events.map((e) => ({ ...e, urn: i + 1 }))))
const total = (key) => view.data.urns.reduce((n, u) => n + u[key].length, 0)
const many = computed(() => view.data.urns.length > 1)
const windowText = computed(() => (range.value[0] == null ? null : t('logs.window', { from: hms(Math.max(range.value[0], 0)), to: hms(Math.min(range.value[1], 86399)) })))

const numbers = computed(() => (params.value.get('n') ?? '').split(/[\s,;]+/).filter(Boolean))
const tallies = useAsync(() => [year.value, args.value, numbers.value], async ([y, a, ns], q) => {
  if (a.length !== 4 || !ns.length) return null
  await Promise.all([ensureState('rdv', y, a[0]), ensure('cands')])
  const rows = objects(await q(`select cs.office, cs.cand, max(c.short_name) name, max(c.party) party, sum(cs.votes)::int votes from cs cs ${candJoin(y)}
    where ${inElection(y, 'cs')} and cs.state = $1 and cs.city = $2 and cs.zone = $3 and cs.section = $4 and cs.cand in (${ns.map((_, i) => `$${i + 5}`)}) group by 1, 2 order by 2, 1`, [...a, ...ns]))
  return ns.flatMap((n) => (rows.some((r) => r.cand === n) ? rows.filter((r) => r.cand === n) : [{ cand: n, office: null, votes: 0 }]))
})

const sec = (v) => t('units.seconds', { n: int(v) })
const voterCols = computed(() => [
  ...(many.value ? [{ key: 'urn', label: t('logs.col.urn') }] : []),
  { key: 'enabled', label: t('logs.col.enabled'), num: true, fmt: hms },
  { key: 'done', label: t('logs.col.done'), num: true, fmt: hms },
  { key: 'dur', label: t('logs.col.duration'), num: true, fmt: sec },
  { key: 'method', label: t('logs.col.method'), fmt: (v) => t(`logs.method.${METHODS[v]}`) },
  { key: 'tries', label: t('logs.col.tries'), num: true },
  { key: 'wrong', label: t('logs.col.wrong'), num: true },
  { key: 'corrected', label: t('logs.col.corrected'), fmt: (v) => (v ? '✓' : '') },
])
const eventCols = computed(() => [
  ...(many.value ? [{ key: 'urn', label: t('logs.col.urn') }] : []),
  { key: 'secs', label: t('logs.col.time'), num: true, fmt: hms },
  { key: 'level', label: t('logs.col.level') },
  { key: 'module', label: t('logs.col.module') },
  { key: 'text', label: t('logs.col.message') },
])
const sectionCols = computed(() => [
  { key: 'zone', label: t('common.zone') },
  { key: 'section', label: t('common.section'), href: (r) => href(year.value, 'logs', [...args.value, r.zone, r.section]) },
  { key: 'n', label: t('time.events'), num: true, fmt: int },
  { key: 'first', label: t('time.first'), num: true, fmt: clock },
  { key: 'last', label: t('time.last'), num: true, fmt: clock },
])
const tallyCols = computed(() => [
  { key: 'cand', label: t('logs.col.number') },
  { key: 'office', label: t('common.office'), fmt: (v) => (v == null ? t('logs.numberNone') : officeName(v)) },
  { key: 'name', label: t('logs.col.candidate') },
  { key: 'party', label: t('logs.col.party') },
  { key: 'votes', label: t('logs.col.votes'), num: true, fmt: int },
])
const place = computed(() => {
  if (isSection.value) return t('time.placeSection', { section: args.value[3], zone: args.value[2], city: args.value[1], state: args.value[0].toUpperCase() })
  if (args.value[1]) return t('time.placeCity', { city: args.value[1], state: args.value[0].toUpperCase() })
  return args.value[0] ? args.value[0].toUpperCase() : t('common.brazil')
})
</script>

<template lang="pug">
h1 {{ t('logs.title', { place, election: electionLabel(year) }) }}
SourceBadge(:election="year" view="times")
.muted(v-if="!cfg.raw.logpack") {{ t('logs.unavailable') }}
template(v-else)
  Notice(kind="info") {{ t('logs.secret') }}
  form.cluster(@submit.prevent="submit")
    Field(:label="t('common.state')")
      select(:value="form.uf" @change="pickState")
        option(value="") {{ t('logs.choose') }}
        option(v-for="s in statesIn('vt', year)" :key="s" :value="s" :selected="s === form.uf") {{ stateTitle(s) }}
    Field(v-if="form.uf && cities.data" :label="t('common.city')")
      select(:value="form.city" @change="set('city', $event)")
        option(value="") {{ t('logs.choose') }}
        option(v-for="c in cities.data" :key="c.city" :value="c.city" :selected="c.city === form.city") {{ c.city }}
    Field(:label="t('common.zone')")
      input(inputmode="numeric" size="5" :value="form.zone" @input="set('zone', $event)")
    Field(:label="t('common.section')")
      input(inputmode="numeric" size="5" :value="form.section" @input="set('section', $event)")
    Field(:label="t('logs.at')")
      input(size="6" placeholder="10:40" :value="form.at" @input="set('at', $event)")
    Field(:label="t('logs.span')")
      select(:value="form.span" @change="set('span', $event)")
        option(v-for="s in SPANS" :key="s" :value="String(s)" :selected="String(s) === form.span") {{ t('logs.spanOption', { n: s }) }}
    Field(:label="t('logs.numbers')")
      input(size="26" placeholder="22111 2211 222 111 10" :value="form.n" @input="set('n', $event)")
    Button(@click="submit") {{ t('logs.show') }}
  p.muted(v-if="args.length < 2") {{ t('logs.intro') }}
  Panel(v-if="args.length === 2" :title="t('logs.cityTitle', { city: args[1], state: args[0].toUpperCase() })" :state="sections" :election="year" wide)
    DataTable(:columns="sectionCols" :rows="slice(sections.data, 'page')" :page="page('page')" :size="PAGE" :total="sections.data.length" @page="setParam('page', $event ? $event + 1 : null)")
  template(v-if="isSection && view.data")
    .cluster
      a(:href="href(year, 'drill', args)") {{ t('time.seeResults') }}
      a(:href="href(year, 'time', args)") {{ t('signals.seeTimes') }}
      a(:href="href(year, 'signals', args)") {{ t('time.seeSignals') }}
    Notice(v-if="!view.data.urns.length" kind="warning") {{ t('logs.absent') }}
    template(v-else)
      p.muted {{ t('logs.clock') }} {{ windowText }}
      Panel(:title="t('logs.votersTitle', { n: int(voters.length), total: int(total('voters')) })" :state="view" :election="year" wide)
        DataTable(v-if="voters.length" :columns="voterCols" :rows="slice(voters, 'vp')" :page="page('vp')" :size="PAGE" :total="voters.length" @page="setParam('vp', $event ? $event + 1 : null)")
        p.muted(v-else) {{ t('logs.noVoters') }}
      Panel(v-if="numbers.length" :title="t('logs.numbersTitle')" :state="tallies" :election="year" wide)
        p.muted {{ t('logs.numbersNote') }}
        DataTable(:columns="tallyCols" :rows="tallies.data")
      Panel(:title="t('logs.eventsTitle', { n: int(events.length), total: int(total('events')) })" :state="view" :election="year" wide)
        DataTable(v-if="events.length" :columns="eventCols" :rows="slice(events, 'ep')" :page="page('ep')" :size="PAGE" :total="events.length" @page="setParam('ep', $event ? $event + 1 : null)")
        p.muted(v-else) {{ t('logs.noEvents') }}
        p.muted {{ t('logs.otherDays', { n: int(view.data.urns.reduce((n, u) => n + u.otherDays, 0)) }) }}
      p.muted {{ t('logs.fetched', { size: bytes(view.data.bytes), index: bytes(view.data.index) }) }}
  Panel(v-else-if="isSection" :title="t('nav.logs')" :state="view" :election="year")
</template>
