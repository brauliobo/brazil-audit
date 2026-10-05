<script setup vapor>
import { computed } from 'vue'
import { route, href, setParam } from '../router'
import { ELECTIONS, STATE_NAMES, OTHERS, candJoin, collate } from '../model'
import { ensure, ensureScope, ensureState } from '../data'
import { useAsync } from '../use'
import { objects } from '../db'
import { int, pct } from '../format'
import Panel from '../components/Panel.vue'
import BarList from '../components/BarList.vue'
import DataTable from '../components/DataTable.vue'
import StateMap from '../components/StateMap.vue'

const LEVELS = ['state', 'city', 'zone', 'section']
const LEVEL_NAMES = ['UF', 'Município', 'Zona', 'Seção']
const LEVEL_PLURAL = ['UFs', 'Municípios', 'Zonas', 'Seções']
const PAGE = 25
const year = computed(() => route.value.election)
const cfg = computed(() => ELECTIONS[year.value])
const args = computed(() => route.value.args)
const office = computed(() => Number(route.value.params.get('office') ?? 1))
const sort = computed(() => ({ key: route.value.params.get('sort') ?? 'unit', dir: route.value.params.get('dir') ?? 'asc' }))
const page = computed(() => Number(route.value.params.get('page') ?? 0))
const nameOf = (r) => (r.name ?? r.cand) + (r.party && r.party !== r.name ? ` (${r.party})` : '')

// $1 = office, $2.. = the path so far
const scope = (a) => a.map((_, i) => ` and ${LEVELS[i]} = $${i + 2}`).join('')

// UF and (except 2026 deputies) municipality listings read the small rollups; deeper levels read the section parts
const rollupGrain = (y, a, o) => a.length === 0 || (a.length === 1 && !(y === '2026' && o >= 6))

async function listRows(y, a, o, s, p, q) {
  const params = [o, ...a]
  const k = a.length
  const roll = rollupGrain(y, a, o)
  const [tot, res, count] = roll ? [`tot_${y}`, `res_${y}`, 'sum(sections)'] : [`sec_${y}`, `cs_${y}`, 'count(*)']
  const top = objects(await q(`select coalesce(c.n, '-') cand, coalesce(max(c.short_name), '${OTHERS}') name, max(c.party) party, sum(cs.votes) votes, sum(sum(cs.votes)) over () total
    from ${res} cs ${candJoin(y)} where cs.office = $1 ${scope(a)} group by 1 order by votes desc limit 10`, params))
  const cands = o === 1 || k > 0 ? top.filter((c) => c.cand !== '-').slice(0, 2) : []
  const child = LEVELS[k]
  const pick = (c, i) => `sum(votes) filter (where cand = $${k + 2 + i}) c${i}`
  const [a0, a1] = cands.map((c) => c.cand)
  const order = s.key === 'unit' ? collate('unit') : s.key
  const rows = objects(await q(`with s as (select ${child} unit, ${count} sections, sum(nominal) nominal, sum(blank) blank, sum(nul) nul from ${tot} where office = $1 ${scope(a)} group by 1),
    c as (select ${child} unit, ${cands.map(pick).join(',') || '0 c0'} from ${res} where office = $1 ${scope(a)} ${cands.length ? `and cand in ($${k + 2}${cands.length > 1 ? `, $${k + 3}` : ''})` : ''} group by 1)
    select s.*, c.c0, ${cands.length > 1 ? 'c.c1' : '0 c1'}, count(*) over () total from s left join c using (unit)
    order by ${order} ${s.dir === 'desc' ? 'desc' : 'asc'}, unit limit ${PAGE} offset ${p * PAGE}`, [...params, ...[a0, a1].filter(Boolean)]))
  return { mode: 'list', cands, rows, total: rows[0]?.total ?? 0, top }
}

async function sectionRows(y, a, q) {
  const rows = objects(await q(`select cs.office, coalesce(c.n, '-') cand, coalesce(max(c.short_name), '${OTHERS}') name, max(c.party) party, sum(cs.votes) votes, max(cs.nominal) nominal
    from cs_${y} cs ${candJoin(y)} where cs.state = $1 and cs.city = $2 and cs.zone = $3 and cs.section = $4 group by 1, 2 order by cs.office, votes desc`, a))
  const totals = objects(await q(`select office, nominal, blank, nul from sec_${y} where state = $1 and city = $2 and zone = $3 and section = $4 order by office`, a))
  return { mode: 'section', offices: totals.map((t) => ({ ...t, rows: rows.filter((r) => r.office === t.office).slice(0, 10) })) }
}

const view = useAsync(() => [year.value, args.value, office.value, sort.value, page.value], async ([y, a, o, s, p], q) => {
  await ensure('cands')
  if (y === '2022') await ensureScope('votes_2022', a[0])
  else if (rollupGrain(y, a, o)) await Promise.all([ensure('tot_2026'), ensure('res_2026')])
  else await (a.length === 4 ? ensureState : ensureScope)('rdv_2026', a[0], o)
  return a.length === 4 ? sectionRows(y, a, q) : listRows(y, a, o, s, p, q)
})

const crumbs = computed(() => [{ t: 'Brasil', h: href(year.value, 'drill') }, ...args.value.map((a, i) => ({
  t: i === 0 ? `${a.toUpperCase()} · ${STATE_NAMES[a]}` : i === 2 ? `Zona ${a}` : i === 3 ? `Seção ${a}` : a,
  h: href(year.value, 'drill', args.value.slice(0, i + 1)),
}))])

const unitCol = computed(() => ({
  key: 'unit', label: LEVEL_NAMES[args.value.length], sortable: true,
  href: (r) => href(year.value, 'drill', [...args.value, r.unit], { office: office.value }),
  fmt: (v) => (args.value.length === 0 ? `${v.toUpperCase()} · ${STATE_NAMES[v]}` : v),
}))
const columns = computed(() => [
  unitCol.value,
  { key: 'sections', label: 'Seções', num: true, sortable: true, fmt: int },
  { key: 'nominal', label: 'Votos nominais', num: true, sortable: true, fmt: int },
  ...view.data.cands.flatMap((c, i) => [
    { key: `c${i}`, label: c.name, num: true, sortable: true, fmt: int },
    { key: `p${i}`, label: `% ${c.name}`, num: true, fmt: (_, r) => pct(r[`c${i}`] / r.nominal) },
  ]),
])
const items = computed(() => view.data.top.map((r) => ({ label: nameOf(r), value: r.votes, text: `${int(r.votes)} · ${pct(r.votes / r.total)}` })))
const onSort = (key) => { setParam('dir', sort.value.key === key && sort.value.dir === 'asc' ? 'desc' : key === 'unit' ? 'asc' : 'desc'); setParam('sort', key); setParam('page', null) }
const sectionItems = (rows) => rows.map((r) => ({ label: nameOf(r), value: r.votes, text: `${int(r.votes)} · ${pct(r.votes / r.nominal)}` }))
</script>

<template lang="pug">
h1 Detalhar · {{ cfg.label }}
nav.crumbs
  template(v-for="(c, i) in crumbs" :key="i")
    span.sep(v-if="i") /
    a(:href="c.h") {{ c.t }}
.error(v-if="view.error")
  strong {{ view.error.message }}
.skeleton(v-else-if="!view.data")
.controls(v-if="args.length < 4 && Object.keys(cfg.offices).length > 1")
  label
    | Cargo
    select(:value="office" @change="setParam('office', $event.target.value)")
      option(v-for="(name, id) in cfg.offices" :key="id" :value="id" :selected="Number(id) === office") {{ name }}
.grid(v-if="view.data && view.data.mode === 'list'")
  Panel(title="Resultado no recorte" :state="view" :election="year")
    BarList(:items="items")
  Panel(v-if="args.length === 1 && args[0] !== 'zz'" :title="`Mapa de ${STATE_NAMES[args[0]]} por município`" :state="view" :election="year")
    StateMap(:year="year" :uf="args[0]" :office="office")
  Panel(:title="LEVEL_PLURAL[args.length]" :state="view" :election="year" wide)
    DataTable(:columns="columns" :rows="view.data.rows" :sort="sort" :page="page" :size="25" :total="Number(view.data.total)" @sort="onSort" @page="setParam('page', $event)")
.grid(v-else-if="view.data")
  Panel(v-for="o in view.data.offices" :key="o.office" :title="cfg.offices[o.office] ?? `Cargo ${o.office}`" :state="view" :election="year")
    BarList(:items="sectionItems(o.rows)")
    p.muted nominais {{ int(o.nominal) }}
      template(v-if="o.blank != null")  · brancos {{ int(o.blank) }} · nulos {{ int(o.nul) }}
  Panel(v-if="cfg.time" title="Horário de votação" :state="view" :election="year")
    a(:href="href(year, 'time', args)") ver horários desta seção →
</template>
