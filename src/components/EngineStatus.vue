<script setup vapor>
import { computed } from 'vue'
import { engine } from '../db'
import { store } from '../data'
import { pct } from '../format'
import { t } from '../i18n'

// The status bar under the header only while something is going on: starting the engine, importing parts, or an error.
const busy = computed(() => engine.error || store.error || !engine.ready || Object.keys(store.progress).length > 0)
</script>

<template lang="pug">
.engine-status(v-if="busy" :class="{ 'engine-status--error': engine.error || store.error }" role="status")
  template(v-if="engine.error || store.error") ✖ {{ engine.error || store.error }}
  template(v-else-if="!engine.ready")
    span {{ t('engine.starting') }}
    progress
  template(v-else)
    span(v-for="(p, key) in store.progress" :key="key") {{ t('engine.importing', { part: key, progress: pct(p, 0) }) }}
</template>
