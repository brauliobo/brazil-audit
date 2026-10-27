<script setup vapor>
import { computed } from 'vue'
import { route, href } from './router'
import { DEFAULT_ELECTION, supportsView } from './model'
import { contextParams } from './election-registry'
import { NAV_AREAS, areaForView } from './navigation'
import { viewName } from './labels'
import { renderError } from './errors'
import { t } from './i18n'
import ElectionPicker from './components/ElectionPicker.vue'
import EngineInfo from './components/EngineInfo.vue'
import EngineStatus from './components/EngineStatus.vue'
import LangSwitch from './components/LangSwitch.vue'
import Logo from './components/Logo.vue'
import Notice from './components/Notice.vue'
import SectionSearch from './components/SectionSearch.vue'
import Tabs from './components/Tabs.vue'
import ThemeSwitch from './components/ThemeSwitch.vue'
import Overview from './views/Overview.vue'
import Drill from './views/Drill.vue'
import Analysis from './views/Analysis.vue'
import Benford from './views/Benford.vue'
import Signals from './views/Signals.vue'
import Time from './views/Time.vue'
import Logs from './views/Logs.vue'
import Sql from './views/Sql.vue'
import Maps from './views/Maps.vue'
import Parliament from './views/Parliament.vue'
import Seats from './views/Seats.vue'
import Design from './views/Design.vue'
import NotFound from './views/NotFound.vue'
import Compare from './views/Compare.vue'
import History from './views/History.vue'

const REPO = 'https://github.com/brauliobo/brazil-audit'
const views = { overview: Overview, maps: Maps, parliament: Parliament, seats: Seats, drill: Drill, analysis: Analysis, benford: Benford, signals: Signals, time: Time, logs: Logs, sql: Sql, design: Design, compare: Compare, history: History }
const current = computed(() => (route.value.notFound ? NotFound : views[route.value.view]))
const election = computed(() => route.value.election)
const context = computed(() => contextParams(election.value,{
  ...Object.fromEntries([...route.value.params].filter(([key]) => ['office','state','city'].includes(key))),
  ...(route.value.view === 'drill' ? {state:route.value.args[0],city:route.value.args[1]} : {}),
}))
const contextHref = (view) => href(election.value,view,[],context.value)
const area = computed(() => areaForView(route.value.view))
const nav = computed(() => NAV_AREAS.filter((a) => a.views.some((v) => supportsView(election.value,v))).map((a) => ({ label: t(`navGroups.${a.id}`), href: contextHref(a.views.find((v) => supportsView(election.value,v))), current: area.value?.id === a.id })))
const subnav = computed(() => (area.value?.views.length > 1 ? area.value.views : []).filter((v) => supportsView(election.value,v)).map((v) => ({ label: viewName(v), href: contextHref(v), current: route.value.view === v })))
</script>

<template lang="pug">
a.skip-link(href="#main") {{ t('app.skip') }}
header.site-header
  a.brand(:href="href(DEFAULT_ELECTION, 'overview')" :aria-label="t('app.home')")
    Logo.brand__full
    Logo.brand__mark(mark)
  Tabs(:items="nav" :label="t('nav.label')")
  .header-end
    ElectionPicker
    details.header-tools
      summary {{ t('navGroups.tools') }}
      .cluster
        a.btn.btn--ghost(:href="contextHref('sql')") {{ t('nav.sql') }}
        a.btn.btn--ghost(:href="`${REPO}#dados-brutos`") {{ t('footer.raw') }}
        LangSwitch
        ThemeSwitch
EngineStatus
main#main(tabindex="-1")
  Tabs(v-if="subnav.length" :items="subnav" :label="t('navGroups.sections')")
  SectionSearch(v-if="!route.notFound && !['design','compare','history'].includes(route.view) && supportsView(election,'logs')")
  Notice(v-if="renderError" kind="danger") {{ t('errors.render', { message: renderError.message }) }}
  component(v-if="supportsView(election,route.view)" :is="current" :key="route.view + route.election")
  Notice(v-else) {{ t('election.unavailableView') }}
footer.site-footer
  EngineInfo
  | {{ t('footer.engine') }}&nbsp;
  a(href="https://pglite.dev") PGlite
  | &nbsp;· Vue 3.6 Vapor · {{ t('footer.data') }} ·&nbsp;
  a(:href="`${REPO}#dados-brutos`") {{ t('footer.raw') }}
  | &nbsp;·&nbsp;
  a(href="https://dadosabertos.tse.jus.br") {{ t('footer.license') }}: CC BY
  | &nbsp;·&nbsp;
  a(:href="href(election, 'design')") {{ t('footer.design') }}
  | &nbsp;·&nbsp;
  a(:href="REPO") {{ t('footer.code') }}
</template>
