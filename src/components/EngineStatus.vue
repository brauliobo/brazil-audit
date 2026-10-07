<script setup vapor>
import { computed } from 'vue'
import { engine } from '../db'
import { store } from '../data'
import { pct } from '../format'
import { t } from '../i18n'

// The status bar under the header only while something is going on: starting the engine, importing parts, or an error.
const busy = computed(() => engine.error || store.error || !engine.ready || parts.value.length > 0)
// one line for all the parts being imported (a whole country loads dozens): how many and their mean progress
const parts = computed(() => Object.values(store.progress))
const mean = computed(() => parts.value.reduce((a, p) => a + p, 0) / parts.value.length)
</script>

<template lang="pug">
.engine-status(v-if="busy" :class="{ 'engine-status--error': engine.error || store.error }" role="status")
  template(v-if="engine.error || store.error") ✖ {{ engine.error || store.error }}
  template(v-else-if="!engine.ready")
    span {{ t('engine.starting') }}
    progress
  template(v-else)
    span {{ t('engine.importing', { n: parts.length, progress: pct(mean, 0) }) }}
    progress(:value="mean")
</template>
