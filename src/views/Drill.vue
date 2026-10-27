<script setup vapor>
import { computed, ref } from 'vue'
import { route, href } from '../router'
import { ELECTIONS } from '../model'
import { electionLabel } from '../labels'
import { t } from '../i18n'
import ElectionResults from '../components/ElectionResults.vue'
import CollectorDrill from '../components/collector/Drill.vue'
const expanded = ref(false)
const cfg = computed(() => ELECTIONS[route.value.election])
</script>
<template lang="pug">
h1 {{ t('nav.drill') }} · {{ electionLabel(route.election) }}
nav.cluster
  a(:href="href(route.election,'drill',[],Object.fromEntries(route.params))") {{ t('common.brazil') }}
  a(v-for="(arg,i) in route.args" :key="i" :href="href(route.election,'drill',route.args.slice(0,i+1),Object.fromEntries(route.params))") {{ arg }}
ElectionResults(drill)
details(v-if="cfg.legacyKey" @toggle="expanded = $event.target.open")
  summary {{ t('electionData.sectionDetails') }}
  CollectorDrill(v-if="expanded")
</template>
