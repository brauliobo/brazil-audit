<script setup vapor>
import { computed, ref } from 'vue'
import { route } from '../router'
import { electionRegistry } from '../election-registry'
import { ELECTIONS } from '../model'
import { electionLabel } from '../labels'
import { t } from '../i18n'
import ElectionResults from '../components/ElectionResults.vue'
import ElectorateProfile from '../components/ElectorateProfile.vue'
import CollectorOverview from '../components/collector/Overview.vue'
const expanded = ref(false)
const profilesExpanded = ref(false)
const cfg = computed(() => ELECTIONS[route.value.election])
const hasProfiles = computed(() => electionRegistry.profiles?.datasets.some((d) => d.years.includes(cfg.value.year)))
</script>
<template lang="pug">
h1 {{ t('overview.title', {election:electionLabel(route.election)}) }}
ElectionResults
details(v-if="hasProfiles" @toggle="profilesExpanded = $event.target.open")
  summary {{ t('profiles.title') }}
  ElectorateProfile(v-if="profilesExpanded" :election="route.election")
//- Section collection evidence remains available alongside the shared source results.
details(v-if="cfg.legacyKey" @toggle="expanded = $event.target.open")
  summary {{ t('electionData.collectionDetails') }}
  CollectorOverview(v-if="expanded")
</template>
