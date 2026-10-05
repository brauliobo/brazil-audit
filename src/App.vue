<script setup vapor>
import { computed } from 'vue'
import { route, href } from './router'
import { ELECTIONS, VIEW_LABELS } from './model'
import EngineStatus from './components/EngineStatus.vue'
import Overview from './views/Overview.vue'
import Drill from './views/Drill.vue'
import Analysis from './views/Analysis.vue'
import Time from './views/Time.vue'
import Sql from './views/Sql.vue'
import Maps from './views/Maps.vue'
import Parliament from './views/Parliament.vue'

const REPO = 'https://github.com/brauliobo/brazil-audit'
const views = { overview: Overview, maps: Maps, parliament: Parliament, drill: Drill, analysis: Analysis, time: Time, sql: Sql }
const current = computed(() => views[route.value.view] ?? Overview)
const election = computed(() => route.value.election)
</script>

<template lang="pug">
header.top
  a.brand(:href="href(election, 'overview')") Auditoria eleitoral
  nav
    a(v-for="(label, v) in VIEW_LABELS" :key="v" :href="href(v === 'parliament' ? '2026' : election, v)" :class="{ on: route.view === v }") {{ label }}
  .elections
    a(v-for="(e, y) in ELECTIONS" :key="y" :href="href(y, route.view, route.args)" :class="{ on: election === y }") {{ e.label }}
EngineStatus
main
  component(:is="current" :key="route.view + route.election")
footer
  | Postgres no navegador via&nbsp;
  a(href="https://pglite.dev") PGlite
  | &nbsp;· Vue 3.6 Vapor · dados: TSE ·&nbsp;
  a(:href="`${REPO}#dados-brutos`") dados brutos
  | &nbsp;·&nbsp;
  a(:href="REPO") código (MIT)
</template>
