<script setup vapor>
import { computed } from 'vue'
import { route } from '../router'
import { ELECTIONS } from '../model'
import SectionBenford from '../components/SectionBenford.vue'
import FactAnalysis from '../components/FactAnalysis.vue'
const legacy = computed(() => Boolean(ELECTIONS[route.value.election].legacyKey))
</script>
<template lang="pug">
SectionBenford(v-if="legacy")
FactAnalysis(v-else mode="benford")
</template>
