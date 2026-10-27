<script setup vapor>
import { computed } from 'vue'
import { route } from '../router'
import { ELECTIONS } from '../model'
import SectionAnalysis from '../components/SectionAnalysis.vue'
import FactAnalysis from '../components/FactAnalysis.vue'
const legacy = computed(() => Boolean(ELECTIONS[route.value.election].legacyKey))
</script>
<template lang="pug">
SectionAnalysis(v-if="legacy")
FactAnalysis(v-else mode="analysis")
</template>
