<script setup vapor>
import { computed } from 'vue'
import { route, setParam } from '../router'
import { ELECTIONS, inElection } from '../model'
import { stateName, stateOptions } from '../labels'
import { t } from '../i18n'
import { blocColor } from '../colors'
import { ensureSmall } from '../data'
import { useAsync } from '../use'
import { objects } from '../db'
import { int } from '../format'
import Panel from '../components/Panel.vue'
import Field from '../components/Field.vue'
import Hemicycle from '../components/Hemicycle.vue'
import DataTable from '../components/DataTable.vue'

// Seats come from the official TSE files (tables seats and elected), never from a recomputed formula.
const CHAMBERS = {
  senate: { office: 5, title: 'parliament.senateTitle', note: 'parliament.senateNote' },
  chamber: { office: 6, title: 'parliament.chamberTitle', note: 'parliament.chamberNote' },
  state: { office: 7, title: 'parliament.stateTitle', note: 'parliament.stateNote' },
  district: { office: 8, title: 'parliament.districtTitle', note: 'parliament.districtNote' },
}
const year = computed(() => route.value.election)
const chamber = computed(() => (route.value.params.get('chamber') in CHAMBERS ? route.value.params.get('chamber') : 'chamber'))
const uf = computed(() => route.value.params.get('uf') ?? 'sp')
const cfg = computed(() => CHAMBERS[chamber.value])
const scoped = computed(() => chamber.value === 'state') // one state assembly at a time
const ufs = computed(() => stateOptions(['df']))

const seats = useAsync(() => [year.value, chamber.value, uf.value], async ([y, c, u], q) => {
  await ensureSmall(y, 'seats')
  const rows = objects(await q(`select bloc, sum(seats)::int seats from seats where office = $1 and ${inElection(y)} and ($2::text = '' or uf = $2) group by 1 order by 2 desc, 1`, [CHAMBERS[c].office, c === 'state' ? u : '']))
  const total = rows.reduce((t, r) => t + r.seats, 0)
  return { total, groups: rows.map((r) => ({ key: r.bloc, label: r.bloc, seats: r.seats, color: blocColor(r.bloc) })) }
})

const elected = useAsync(() => [year.value, chamber.value], async ([y, c], q) => {
  if (c !== 'senate') return null
  await ensureSmall(y, 'elected')
  return objects(await q(`select uf, name, party, votes from elected where office = 5 and ${inElection(y)} order by uf, votes desc`))
})
const cols = computed(() => [
  { key: 'uf', label: t('common.state'), fmt: (v) => v.toUpperCase() },
  { key: 'name', label: t('parliament.electedName') },
  { key: 'party', label: t('common.party') },
  { key: 'votes', label: t('common.votes'), num: true, fmt: int },
])
const total = computed(() => seats.data?.total ?? 0)
const title = computed(() => t(cfg.value.title, { n: int(total.value), state: stateName(uf.value) }))
const note = computed(() => t(cfg.value.note, { year: ELECTIONS[year.value].year, n: int(total.value) }))
</script>

<template lang="pug">
h1 {{ t('parliament.title', { year: ELECTIONS[year].year }) }}
.cluster
  Field(:label="t('parliament.house')")
    select(@change="setParam('chamber', $event.target.value)")
      option(value="senate" :selected="chamber === 'senate'") {{ t('parliament.senate') }}
      option(value="chamber" :selected="chamber === 'chamber'") {{ t('parliament.chamber') }}
      option(value="state" :selected="chamber === 'state'") {{ t('parliament.state') }}
      option(value="district" :selected="chamber === 'district'") {{ t('parliament.district') }}
  Field(v-if="scoped" :label="t('common.state')")
    select(@change="setParam('uf', $event.target.value)")
      option(v-for="[s, name] in ufs" :key="s" :value="s" :selected="s === uf") {{ name }}
.grid-auto
  Panel(:title="title" :state="seats" :election="year" wide)
    Hemicycle(:groups="seats.data.groups" :label="t('parliament.seatsBy', { title, count: seats.data.total })")
    p.muted {{ note }}
    p.muted {{ t('parliament.source') }}
  Panel(v-if="chamber === 'senate'" :title="t('parliament.elected')" :state="elected" :election="year" wide)
    DataTable(:columns="cols" :rows="elected.data")
</template>
