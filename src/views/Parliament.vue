<script setup vapor>
import { computed } from 'vue'
import { route } from '../router'
import { ELECTIONS } from '../model'
import { t } from '../i18n'
import NativeParliament from '../components/NativeParliament.vue'
import ObservedParliament from '../components/ObservedParliament.vue'
const native=computed(()=>Boolean(ELECTIONS[route.value.election].hasSeats))
</script>
<template lang="pug">
ObservedParliament
details(v-if="native")
  summary {{ t('candidateRoster.nativeComposition') }}
  NativeParliament
</template>
