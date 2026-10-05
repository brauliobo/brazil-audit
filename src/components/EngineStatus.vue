<script setup vapor>
import { ref } from 'vue'
import { engine } from '../db'
import { store, clearLocal } from '../data'
import { pct } from '../format'
import { t } from '../i18n'
import Button from './Button.vue'

const clearing = ref(false)
function clear() {
  if (!confirm(t('engine.clearConfirm'))) return
  clearing.value = true
  clearLocal()
}
</script>

<template lang="pug">
.engine-status(:class="{ 'engine-status--error': engine.error || store.error }" role="status")
  template(v-if="engine.error || store.error") ✖ {{ engine.error || store.error }}
  template(v-else-if="!engine.ready")
    span {{ t('engine.starting') }}
    progress
  template(v-else)
    span {{ t('engine.ready', { count: engine.queries }) }}
    span(v-for="(p, key) in store.progress" :key="key") {{ t('engine.importing', { part: key, progress: pct(p, 0) }) }}
    Button(variant="ghost" :disabled="clearing" :title="t('engine.clearHint')" @click="clear") {{ clearing ? t('engine.clearing') : t('engine.clear') }}
</template>
