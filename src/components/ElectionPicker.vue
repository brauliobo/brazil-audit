<script setup vapor>
import { computed } from 'vue'
import { contextParams, selectedOffice } from '../election-registry'
import { ELECTIONS, ELECTION_LIST } from '../model'
import { go, href, route } from '../router'
import { t } from '../i18n'
import { electionDateLabel } from '../labels'
import Field from './Field.vue'

const years = [...new Set(ELECTION_LIST.map((e) => e.year))].sort((a,b) => b-a)
const current = computed(() => ELECTIONS[route.value.election])
const sessions = computed(() => ELECTION_LIST.filter((e) => e.year === current.value.year))
const label = (e) => [e.description, electionDateLabel(e), e.turn == null ? null : t('election.turnShort',e)].filter(Boolean).join(' · ')
const to = (key) => {
  const params = Object.fromEntries(route.value.params)
  if (params.office) params.office = selectedOffice(route.value.election,params.office).key
  return href(key,route.value.view,[],contextParams(key,params,true))
}
const pickYear = (year) => {
  const options = ELECTION_LIST.filter((e) => e.year === Number(year))
  go(to((options.find((e) => e.legacyKey && e.turn === current.value.turn) ?? options[0]).key))
}
</script>

<template lang="pug">
.picker.cluster
  Field(:label="t('election.year')")
    select(:value="current.year" @change="pickYear($event.target.value)")
      option(v-for="year in years" :key="year" :value="year" :selected="year === current.year") {{ year }}
  Field(:label="t('election.session')")
    select.picker__session(:value="current.key" @change="go(to($event.target.value))")
      option(v-for="e in sessions" :key="e.key" :value="e.key" :selected="e.key === current.key") {{ label(e) }}
</template>

<style scoped>
.picker__session { max-width: min(var(--size-column-min), 100%); }
.picker :deep(.field) { min-width: 0; max-width: 100%; }
.picker { min-width: 0; max-width: 100%; }
</style>
