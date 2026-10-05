<script setup vapor>
import { computed } from 'vue'

// Horizontal bars: items = [{ label, value, text?, href? }]; bars are scaled to the largest value.
const props = defineProps({ items: Array })
const top = computed(() => Math.max(...props.items.map((i) => i.value), 1e-9))
</script>

<template lang="pug">
.bars
  .bars__row(v-for="(it, i) in items" :key="i")
    a.bars__label(v-if="it.href" :href="it.href" :title="it.label") {{ it.label }}
    span.bars__label(v-else :title="it.label") {{ it.label }}
    .bars__track
      .bars__fill(:style="{ width: (100 * it.value / top) + '%' }")
    span.bars__value {{ it.text ?? it.value }}
</template>
