<script setup vapor>
import { ref } from 'vue'
import { engine } from '../db'
import { clearLocal } from '../data'
import { t } from '../i18n'
import Button from './Button.vue'

// Footer line: which engine runs the queries and the way to forget the imported data.
const clearing = ref(false)
function clear() {
  if (!confirm(t('engine.clearConfirm'))) return
  clearing.value = true
  clearLocal()
}
</script>

<template lang="pug">
p.engine-info(v-if="engine.ready")
  span {{ t('engine.ready', { count: engine.queries }) }}
  Button(variant="ghost" :disabled="clearing" :title="t('engine.clearHint')" @click="clear") {{ clearing ? t('engine.clearing') : t('engine.clear') }}
</template>
