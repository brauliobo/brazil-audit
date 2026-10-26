<script setup vapor>
import { computed, ref, watch } from 'vue'
import { route, href, go } from '../router'
import { ELECTIONS, inElection } from '../model'
import { REPO } from '../elections'
import { stateTitle } from '../labels'
import { ensureSmall } from '../data'
import { useAsync } from '../use'
import { objects } from '../db'
import { int, pct } from '../format'
import { t } from '../i18n'
import Panel from './Panel.vue'
import Field from './Field.vue'
import DataTable from './DataTable.vue'

const BASE = import.meta.env.BASE_URL
const props = defineProps({ year: String, summary: Boolean })
const args = computed(() => props.summary ? [] : route.value.args)
const state = computed(() => args.value[0] ?? '')
const city = computed(() => args.value[1] ?? '')
const zone = computed(() => args.value[2] ?? '')
const page = ref(0)
watch(args, () => { page.value = 0 })
const base = useAsync(() => [props.year], async ([y]) => { await ensureSmall(y, 'turnout'); return true })
const data = useAsync(() => [props.year, args.value, base.loading], async ([y, a], q) => {
  if (base.loading) return null
  const rows = objects(await q(`select *, absent::float8 / nullif(installed,0) rate from turnout where ${inElection(y)} order by state,city,zone`))
  const selected = rows.find((r) => r.scope === (a[2] ? 'zone' : a[1] ? 'city' : a[0] ? 'uf' : 'br') && r.state === (a[0] || 'br') && r.city === (a[1] ?? null) && r.zone === (a[2] ?? null))
  const children = rows.filter((r) => a[2] ? r === selected : a[1] ? r.scope === 'zone' && r.state === a[0] && r.city === a[1] : a[0] ? r.scope === 'city' && r.state === a[0] : r.scope === 'uf')
  return { selected, children, states: rows.filter((r) => r.scope === 'uf'), cities: rows.filter((r) => r.scope === 'city' && r.state === a[0]), zones: rows.filter((r) => r.scope === 'zone' && r.state === a[0] && r.city === a[1]) }
})
const pick = (a) => go(href(props.year,'signals',a))
const label = (r) => r.scope === 'uf' ? stateTitle(r.state) : r.scope === 'city' ? r.city : r.zone
const columns = computed(() => [
  { key: 'place', label: t('turnout.place'), fmt: (_,r) => label(r), href: (r) => href(props.year,'signals',[r.state,...(r.city ? [r.city] : []),...(r.zone ? [r.zone] : [])]) },
  { key: 'electorate', label: t('turnout.electorate'), num: true, fmt: int },
  { key: 'present', label: t('turnout.present'), num: true, fmt: int },
  { key: 'absent', label: t('turnout.absent'), num: true, fmt: int },
  { key: 'rate', label: t('turnout.rate'), num: true, fmt: (v) => pct(v,2) },
])
</script>

<template lang="pug">
Panel(:title="t('turnout.title')" :state="data" :election="year" wide)
  .cluster(v-if="!summary")
    Field(:label="t('common.state')")
      select(:value="state" @change="pick($event.target.value ? [$event.target.value] : [])")
        option(value="") {{ t('common.brazil') }}
        option(v-for="r in data.data.states" :key="r.state" :value="r.state") {{ stateTitle(r.state) }}
    Field(v-if="state" :label="t('common.city')")
      select(:value="city" @change="pick($event.target.value ? [state,$event.target.value] : [state])")
        option(value="") {{ t('common.allCities') }}
        option(v-for="r in data.data.cities" :key="r.city" :value="r.city") {{ r.city }}
    Field(v-if="city" :label="t('turnout.zone')")
      select(:value="zone" @change="pick($event.target.value ? [state,city,$event.target.value] : [state,city])")
        option(value="") {{ t('turnout.allZones') }}
        option(v-for="r in data.data.zones" :key="r.zone" :value="r.zone") {{ r.zone }}
  template(v-if="data.data.selected")
    ul
      li {{ t('turnout.summaryAbsent', { n: int(data.data.selected.absent), rate: pct(data.data.selected.rate,2) }) }}
      li {{ t('turnout.summaryPresent', { n: int(data.data.selected.present), rate: pct(data.data.selected.installed ? data.data.selected.present / data.data.selected.installed : null,2) }) }}
      li {{ t('turnout.summaryElectorate', { n: int(data.data.selected.electorate) }) }}
    p.muted {{ t('turnout.denominator', { n: int(data.data.selected.installed), excluded: int(data.data.selected.not_installed) }) }}
    p.muted
      a(:href="data.data.selected.url" target="_blank" rel="noopener") {{ t('turnout.source') }}
      |  · {{ data.data.selected.generated }}
    p.muted
      a(:href="`${BASE}data/turnout/${year}.csv.gz`" download) {{ t('turnout.download') }}
      |  ·
      a(:href="`https://github.com/${REPO}/releases/download/${ELECTIONS[year].raw.tag}/${year}-official-turnout.zip`") {{ t('turnout.rawDownload') }}
  p(v-if="summary")
    a(:href="href(year,'signals')") {{ t('turnout.details') }}
  template(v-else)
    DataTable(:columns="columns" :rows="data.data.children.slice(page * 25,(page + 1) * 25)" :page="page" :size="25" :total="data.data.children.length" @page="page = $event")
    p.muted {{ t('turnout.scopeNote') }}
</template>
