<script setup vapor>
import { computed, reactive } from 'vue'
import { route, href } from '../router'
import { ELECTIONS } from '../model'
import { electionLabel, stateName, stateTitle } from '../labels'
import { t } from '../i18n'
import { ensureSmall, ensureState } from '../data'
import { useAsync } from '../use'
import { objects } from '../db'
import { int, pct } from '../format'
import { childrenSql, levelOf, lowestSql, sharesOf, totalOf } from '../biometrics'
import Panel from '../components/Panel.vue'
import Notice from '../components/Notice.vue'
import Tabs from '../components/Tabs.vue'
import Stat from '../components/Stat.vue'
import Breadcrumb from '../components/Breadcrumb.vue'
import DataTable from '../components/DataTable.vue'
import BarList from '../components/BarList.vue'

const TABS = ['places', 'sections']
const MIN = 50 // identifications a section needs to be ranked
const TOP = 10

const key = computed(() => route.value.election)
const cfg = computed(() => ELECTIONS[key.value])
const args = computed(() => route.value.args)
const [state, city] = [computed(() => args.value[0] ?? null), computed(() => args.value[1] ?? null)]
const level = computed(() => levelOf(args.value))
const tab = computed(() => (TABS.includes(route.value.params.get('tab')) ? route.value.params.get('tab') : 'places'))
const keepTab = computed(() => (tab.value === 'places' ? {} : { tab: tab.value }))
const tabItems = computed(() => TABS.map((id) => ({ href: href(key.value, 'biometrics', id === 'sections' ? args.value.slice(0, 1) : args.value, id === 'places' ? {} : { tab: id }), label: t(`biometrics.tab.${id}`), current: id === tab.value })))

const base = useAsync(() => [key.value, state.value, city.value, tab.value], async ([k, s, , tb]) => {
  await ensureSmall(k, 'sgz')
  if (s && (args.value[2] || tb === 'sections')) await ensureState('sg', k, s)
  return true
})
const use = (run) => useAsync(() => [key.value, args.value.join('/'), tab.value, base.loading], async ([, , , loading], q) => (loading ? null : run(async ({ sql, params }) => objects(await q(sql, params)))))

const children = use(async (r) => {
  const rows = (await r(childrenSql(args.value, cfg.value.year, cfg.value.turn))).map(sharesOf)
  return { rows, total: totalOf(rows) }
})
const lowest = use(async (r) => (tab.value === 'sections' && state.value ? (await r(lowestSql(cfg.value.year, cfg.value.turn, state.value, MIN))).map(sharesOf) : null))

const place = computed(() => (args.value[2] ? t('biometrics.zone', { zone: args.value[2] }) : city.value ?? (state.value ? stateName(state.value) : t('common.brazil'))))
const crumbs = computed(() => [{ label: t('common.brazil'), href: href(key.value, 'biometrics', [], keepTab.value) }, ...args.value.map((a, i) => ({ label: i === 0 ? stateTitle(a) : i === 2 ? t('biometrics.zone', { zone: a }) : a, href: href(key.value, 'biometrics', args.value.slice(0, i + 1), keepTab.value) }))])
const childName = (r) => (level.value === 'country' ? stateTitle(r.k) : level.value === 'zone' ? t('biometrics.section', { section: r.k }) : level.value === 'state' ? r.k : t('biometrics.zone', { zone: r.k }))
const childHref = (r) => (level.value === 'zone' ? href(key.value, 'signals', [...args.value, r.k]) : href(key.value, 'biometrics', [...args.value, r.k], keepTab.value))
const sc = reactive({ key: 'noFpShare', dir: 'desc' })
const onSort = (k) => Object.assign(sc, { key: k, dir: sc.key === k && sc.dir === 'desc' ? 'asc' : 'desc' })
const sorted = computed(() => [...(children.data?.rows ?? [])].sort((x, y) => (sc.dir === 'asc' ? 1 : -1) * ((x[sc.key] ?? -1) - (y[sc.key] ?? -1))))
const share = (k, label) => ({ key: k, label: t(label), num: true, sortable: true, fmt: (v) => pct(v, 1) })
const cols = computed(() => [
  { key: 'k', label: t(`biometrics.col.${['state', 'city', 'zone', 'section'][Math.min(args.value.length, 3)]}`), fmt: (_, r) => childName(r), href: childHref },
  { key: 'total', label: t('biometrics.col.total'), num: true, sortable: true, fmt: int },
  share('bioShare', 'biometrics.col.bio'), share('manShare', 'biometrics.col.man'), share('norShare', 'biometrics.col.nor'), share('noFpShare', 'biometrics.col.noFp'),
])
const stats = computed(() => {
  const s = children.data?.total
  return s ? [[int(s.total), t('biometrics.col.total')], [pct(s.bioShare, 1), t('biometrics.col.bio')], [pct(s.manShare, 1), t('biometrics.col.man')], [pct(s.norShare, 1), t('biometrics.col.nor')]] : []
})
const worst = computed(() => sorted.value.filter((r) => r.total >= MIN).slice(0, TOP).map((r) => ({ label: childName(r), value: r.noFpShare ?? 0, text: pct(r.noFpShare, 1), href: childHref(r) })))
const sectionCols = computed(() => [
  { key: 'city', label: t('biometrics.col.section'), fmt: (v, r) => `${v} · ${t('biometrics.zone', { zone: r.zone })} · ${t('biometrics.section', { section: r.section })}`, href: (r) => href(key.value, 'signals', [state.value, r.city, r.zone, r.section]) },
  { key: 'total', label: t('biometrics.col.total'), num: true, fmt: int }, share('bioShare', 'biometrics.col.bio'), share('manShare', 'biometrics.col.man'), share('norShare', 'biometrics.col.nor'),
])
</script>

<template lang="pug">
h1 {{ t('biometrics.title', { place, election: electionLabel(key) }) }}
Notice(kind="warning") {{ t('biometrics.caution') }}
Breadcrumb(:items="crumbs" :label="t('biometrics.breadcrumb')")
Tabs(:items="tabItems" :label="t('biometrics.tabs')")
Notice(v-if="base.error" kind="danger") {{ base.error.message }}
.grid-auto(v-else)
  template(v-if="tab === 'places'")
    Panel(:title="t('biometrics.summary')" :state="children" :election="key" wide)
      .cluster
        Stat(v-for="s in stats" :key="s[1]" :value="s[0]" :label="s[1]")
      p.muted {{ t('biometrics.meaning') }}
    Panel(:title="t('biometrics.worst', { min: MIN })" :state="children" :election="key")
      BarList(:items="worst")
    Panel(:title="t(`biometrics.children.${level}`)" :state="children" :election="key" wide)
      DataTable(:columns="cols" :rows="sorted" :sort="sc" @sort="onSort")
  template(v-else)
    Panel(:title="t('biometrics.sectionsTitle', { min: MIN })" :state="lowest" :election="key" wide)
      p.muted(v-if="!state") {{ t('biometrics.pickState') }}
      template(v-else-if="lowest.data")
        p.muted {{ t('biometrics.sectionsNote', { min: MIN }) }}
        DataTable(:columns="sectionCols" :rows="lowest.data")
</template>
