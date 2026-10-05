<script setup vapor>
import { computed } from 'vue'
import { route, href, setParam } from '../router'
import { ELECTIONS, candJoin, collate, inElection } from '../model'
import { electionLabel, officeName, stateName, stateTitle } from '../labels'
import { t } from '../i18n'
import { ensure, ensureScope, ensureSmall, ensureState } from '../data'
import { residualOn, rollup } from '../results'
import { useAsync } from '../use'
import { objects } from '../db'
import { int, pct } from '../format'
import Panel from '../components/Panel.vue'
import Field from '../components/Field.vue'
import Notice from '../components/Notice.vue'
import Skeleton from '../components/Skeleton.vue'
import Breadcrumb from '../components/Breadcrumb.vue'
import BarList from '../components/BarList.vue'
import DataTable from '../components/DataTable.vue'
import StateMap from '../components/StateMap.vue'
import ResidualSwitch from '../components/ResidualSwitch.vue'

const LEVELS = ['state', 'city', 'zone', 'section']
const PAGE = 25
const year = computed(() => route.value.election)
const cfg = computed(() => ELECTIONS[year.value])
const args = computed(() => route.value.args)
const office = computed(() => Number(route.value.params.get('office') ?? 1))
const sort = computed(() => ({ key: route.value.params.get('sort') ?? 'unit', dir: route.value.params.get('dir') ?? 'asc' }))
const page = computed(() => Number(route.value.params.get('page') ?? 0))
const nameOf = (r) => (r.name ?? t('common.others')) + (r.party && r.party !== r.name ? ` (${r.party})` : '')

// $1 = office, $2.. = the path so far
const scope = (a) => a.map((_, i) => ` and ${LEVELS[i]} = $${i + 2}`).join('')

// UF and (except deputies, whose rollup is per UF) municipality listings read the small rollups; deeper levels read the section parts
const rollupGrain = (a, o) => a.length === 0 || (a.length === 1 && o < 6)

async function listRows(y, a, o, s, p, q) {
  const params = [o, ...a]
  const k = a.length
  const roll = rollupGrain(a, o)
  const [tot, res, count] = roll ? [rollup(y).tot, rollup(y).res, 'sum(sections)'] : ['sec', 'cs', 'count(*)']
  const top = objects(await q(`select coalesce(c.n, '-') cand, max(c.short_name) name, max(c.party) party, sum(cs.votes) votes, sum(sum(cs.votes)) over () total
    from ${res} cs ${candJoin(y)} where cs.office = $1 and ${inElection(y, 'cs')} ${scope(a)} group by 1 order by votes desc limit 10`, params))
  const cands = o === 1 || k > 0 ? top.filter((c) => c.cand !== '-').slice(0, 2) : []
  const child = LEVELS[k]
  const pick = (c, i) => `sum(votes) filter (where cand = $${k + 2 + i}) c${i}`
  const [a0, a1] = cands.map((c) => c.cand)
  const order = s.key === 'unit' ? collate('unit') : s.key
  const rows = objects(await q(`with s as (select ${child} unit, ${count} sections, sum(nominal) nominal, sum(blank) blank, sum(nul) nul from ${tot} where office = $1 and ${inElection(y)} ${scope(a)} group by 1),
    c as (select ${child} unit, ${cands.map(pick).join(',') || '0 c0'} from ${res} where office = $1 and ${inElection(y)} ${scope(a)} ${cands.length ? `and cand in ($${k + 2}${cands.length > 1 ? `, $${k + 3}` : ''})` : ''} group by 1)
    select s.*, c.c0, ${cands.length > 1 ? 'c.c1' : '0 c1'}, count(*) over () total from s left join c using (unit)
    order by ${order} ${s.dir === 'desc' ? 'desc' : 'asc'}, unit limit ${PAGE} offset ${p * PAGE}`, [...params, ...[a0, a1].filter(Boolean)]))
  const total = rows[0]?.total ?? 0
  const lastPage = (p + 1) * PAGE >= total
  const shown = !roll && ELECTIONS[y].hasResidual && k === 2 && residualOn.value ? await withResidual(rows, a, o, cands, lastPage, y, q) : rows
  return { mode: 'list', cands, rows: shown, total, top }
}

// The zones of a city add up to the official totals only with the residual rows (official zone total minus the sections with files):
// one marked row after each zone that has missing sections, and, on the last page, zones without any section file and the
// city-level row used when a zone file could not be used.
async function withResidual(rows, a, o, cands, lastPage, y, q) {
  const picks = cands.map((_, i) => `, sum(votes) filter (where number = $${4 + i}) c${i}`).join('')
  const found = objects(await q(`select zone, max(sections_missing) sections, sum(votes) filter (where number not in ('branco', 'nulo')) nominal, coalesce(sum(votes) filter (where number = 'branco'), 0) blank,
    coalesce(sum(votes) filter (where number = 'nulo'), 0) nul${picks} from residual where uf = $1 and city = $2 and office = $3 and ${inElection(y)} group by zone order by zone`, [a[0], a[1], o, ...cands.map((c) => c.cand)]))
  if (!found.length) return rows
  const inDump = new Set(objects(await q(`select distinct zone from sec where state = $1 and city = $2 and ${inElection(y)}`, [a[0], a[1]])).map((r) => r.zone))
  const noteKey = (r) => (!r.zone ? 'drill.cityRow' : inDump.has(r.zone) ? 'drill.zoneRow' : 'drill.zoneRowEmpty')
  const note = (r) => ({ residual: true, ...r, c0: r.c0 ?? 0, c1: r.c1 ?? 0, key: noteKey(r) })
  const after = rows.flatMap((row) => [row, ...found.filter((r) => r.zone === row.unit).map(note)])
  return lastPage ? [...after, ...found.filter((r) => !r.zone || !inDump.has(r.zone)).map(note)] : after
}

async function sectionRows(y, a, q) {
  const rows = objects(await q(`select cs.office, coalesce(c.n, '-') cand, max(c.short_name) name, max(c.party) party, sum(cs.votes) votes, max(cs.nominal) nominal
    from cs cs ${candJoin(y)} where ${inElection(y, 'cs')} and cs.state = $1 and cs.city = $2 and cs.zone = $3 and cs.section = $4 group by 1, 2 order by cs.office, votes desc`, a))
  const totals = objects(await q(`select office, nominal, blank, nul from sec where ${inElection(y)} and state = $1 and city = $2 and zone = $3 and section = $4 order by office`, a))
  return { mode: 'section', offices: totals.map((t) => ({ ...t, rows: rows.filter((r) => r.office === t.office).slice(0, 10) })) }
}

const view = useAsync(() => [year.value, args.value, office.value, sort.value, page.value, residualOn.value], async ([y, a, o, s, p], q) => {
  await ensure('cands')
  if (rollupGrain(a, o)) await ensureSmall(y, 'tot', 'res', 'residual')
  else await (a.length === 4 ? ensureState : ensureScope)('rdv', y, a[0], o)
  return a.length === 4 ? sectionRows(y, a, q) : listRows(y, a, o, s, p, q)
})

const crumbs = computed(() => [{ label: t('common.brazil'), href: href(year.value, 'drill') }, ...args.value.map((a, i) => ({
  label: i === 0 ? stateTitle(a) : i === 2 ? t('drill.zoneCrumb', { zone: a }) : i === 3 ? t('drill.sectionCrumb', { section: a }) : a,
  href: href(year.value, 'drill', args.value.slice(0, i + 1)),
}))])

const unitCol = computed(() => ({
  key: 'unit', label: t(`drill.level.${LEVELS[args.value.length]}`), sortable: true,
  href: (r) => !r.residual && href(year.value, 'drill', [...args.value, r.unit], { office: office.value }),
  fmt: (v, r) => (r?.residual ? t(r.key, { count: r.sections, zone: r.zone }) : args.value.length === 0 ? stateTitle(v) : v),
}))
const columns = computed(() => [
  unitCol.value,
  { key: 'sections', label: t('common.sections'), num: true, sortable: true, fmt: int },
  { key: 'nominal', label: t('common.nominalVotes'), num: true, sortable: true, fmt: int },
  ...view.data.cands.flatMap((c, i) => [
    { key: `c${i}`, label: c.name, num: true, sortable: true, fmt: int },
    { key: `p${i}`, label: t('drill.percent', { name: c.name }), num: true, fmt: (_, r) => pct(r[`c${i}`] / r.nominal) },
  ]),
])
const items = computed(() => view.data.top.map((r) => ({ label: nameOf(r), value: r.votes, text: `${int(r.votes)} · ${pct(r.votes / r.total)}` })))
const officeTotals = (o) => [t('common.nominal', { n: int(o.nominal) }), ...(o.blank == null ? [] : [t('common.blank', { n: int(o.blank) }), t('common.nul', { n: int(o.nul) })])].join(' · ')
const onSort = (key) => { setParam('dir', sort.value.key === key && sort.value.dir === 'asc' ? 'desc' : key === 'unit' ? 'asc' : 'desc'); setParam('sort', key); setParam('page', null) }
const sectionItems = (rows) => rows.map((r) => ({ label: nameOf(r), value: r.votes, text: `${int(r.votes)} · ${pct(r.votes / r.nominal)}` }))
</script>

<template lang="pug">
h1 {{ t('drill.title', { election: electionLabel(year) }) }}
Breadcrumb(:items="crumbs" :label="t('drill.where')")
Notice(v-if="view.error" kind="danger")
  strong {{ view.error.message }}
Skeleton(v-else-if="!view.data")
.cluster(v-if="args.length < 4")
  ResidualSwitch(v-if="cfg.hasResidual && args.length < 3")
  Field(v-if="cfg.offices.length > 1" :label="t('common.office')")
    select(:value="office" @change="setParam('office', $event.target.value)")
      option(v-for="id in cfg.offices" :key="id" :value="id" :selected="id === office") {{ officeName(id) }}
.grid-auto(v-if="view.data && view.data.mode === 'list'")
  Panel(:title="t('drill.result')" :state="view" :election="year")
    BarList(:items="items")
  Panel(v-if="args.length === 1 && args[0] !== 'zz'" :title="t('maps.stateMapTitle', { state: stateName(args[0]) })" :state="view" :election="year")
    StateMap(:year="year" :uf="args[0]" :office="office")
  Panel(:title="t(`drill.levels.${LEVELS[args.length]}`)" :state="view" :election="year" wide)
    DataTable(:columns="columns" :rows="view.data.rows" :sort="sort" :page="page" :size="25" :total="Number(view.data.total)" @sort="onSort" @page="setParam('page', $event)")
.grid-auto(v-else-if="view.data")
  Panel(v-for="o in view.data.offices" :key="o.office" :title="cfg.offices.includes(o.office) ? officeName(o.office) : t('drill.officeFallback', { id: o.office })" :state="view" :election="year")
    BarList(:items="sectionItems(o.rows)")
    p.muted {{ officeTotals(o) }}
  Panel(v-if="cfg.hasTimes" :title="t('drill.voteTime')" :state="view" :election="year")
    a(:href="href(year, 'time', args)") {{ t('drill.seeTimes') }}
</template>
