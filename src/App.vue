<script setup vapor>
import { computed } from 'vue'
import { route, href } from './router'
import { DEFAULT_ELECTION, ELECTIONS, SEATS_ELECTION, VIEWS_NAV } from './model'
import { viewName } from './labels'
import { t } from './i18n'
import ElectionPicker from './components/ElectionPicker.vue'
import EngineStatus from './components/EngineStatus.vue'
import LangSwitch from './components/LangSwitch.vue'
import Logo from './components/Logo.vue'
import Tabs from './components/Tabs.vue'
import ThemeSwitch from './components/ThemeSwitch.vue'
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
const nav = computed(() => VIEWS_NAV.map((v) => ({ label: viewName(v), href: href(v === 'parliament' && !ELECTIONS[election.value].hasSeats ? SEATS_ELECTION : election.value, v), current: route.value.view === v })))
</script>

<template lang="pug">
header.site-header
  a.brand(:href="href(DEFAULT_ELECTION, 'overview')" :aria-label="t('app.home')")
    Logo.brand__full
    Logo.brand__mark(mark)
  Tabs(:items="nav" :label="t('nav.label')")
  .header-tools
    ElectionPicker
    LangSwitch
    ThemeSwitch
EngineStatus
main
  component(:is="current" :key="route.view + route.election")
footer.site-footer
  | {{ t('footer.engine') }}&nbsp;
  a(href="https://pglite.dev") PGlite
  | &nbsp;· Vue 3.6 Vapor · {{ t('footer.data') }} ·&nbsp;
  a(:href="`${REPO}#dados-brutos`") {{ t('footer.raw') }}
  | &nbsp;·&nbsp;
  a(:href="href(election, 'design')") {{ t('footer.design') }}
  | &nbsp;·&nbsp;
  a(:href="REPO") {{ t('footer.code') }}
</template>
