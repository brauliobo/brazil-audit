<script setup vapor>
import { computed } from 'vue'
import { route, href } from './router'
import { DEFAULT_ELECTION, ELECTIONS, SEATS_ELECTION, VIEW_LABELS } from './model'
import EngineStatus from './components/EngineStatus.vue'
import Logo from './components/Logo.vue'
import Tabs from './components/Tabs.vue'
import Overview from './views/Overview.vue'
import Drill from './views/Drill.vue'
import Analysis from './views/Analysis.vue'
import Time from './views/Time.vue'
import Sql from './views/Sql.vue'
import Maps from './views/Maps.vue'
import Parliament from './views/Parliament.vue'
import Design from './views/Design.vue'

const REPO = 'https://github.com/brauliobo/brazil-audit'
const views = { overview: Overview, maps: Maps, parliament: Parliament, drill: Drill, analysis: Analysis, time: Time, sql: Sql, design: Design }
const current = computed(() => views[route.value.view] ?? Overview)
const election = computed(() => route.value.election)
const nav = computed(() => Object.entries(VIEW_LABELS).map(([v, label]) => ({ label, href: href(v === 'parliament' && !ELECTIONS[election.value].hasSeats ? SEATS_ELECTION : election.value, v), current: route.value.view === v })))
const elections = computed(() => Object.entries(ELECTIONS).map(([y, e]) => ({ label: e.label, href: href(y, route.value.view, route.value.args), current: election.value === y })))
</script>

<template lang="pug">
header.site-header
  a.brand(:href="href(DEFAULT_ELECTION, 'overview')" aria-label="Auditoria eleitoral: início")
    Logo.brand__full
    Logo.brand__mark(mark)
  Tabs(:items="nav" label="Seções do site")
  Tabs(:items="elections" label="Eleição" end)
EngineStatus
main
  component(:is="current" :key="route.view + route.election")
footer.site-footer
  | Postgres no navegador via&nbsp;
  a(href="https://pglite.dev") PGlite
  | &nbsp;· Vue 3.6 Vapor · dados: TSE ·&nbsp;
  a(:href="`${REPO}#dados-brutos`") dados brutos
  | &nbsp;·&nbsp;
  a(:href="href(election, 'design')") design
  | &nbsp;·&nbsp;
  a(:href="REPO") código (MIT)
</template>
