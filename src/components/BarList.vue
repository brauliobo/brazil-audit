<script setup vapor>
import { computed } from 'vue'

// Horizontal bars: items = [{ label, value, text?, href? }]; bars are scaled to the largest value.
const props = defineProps({ items: Array })
const top = computed(() => Math.max(...props.items.map((i) => i.value), 1e-9))
</script>

<template lang="pug">
.bars
  .row(v-for="(it, i) in items" :key="i")
    a.label(v-if="it.href" :href="it.href") {{ it.label }}
    span.label(v-else) {{ it.label }}
    .track
      .fill(:style="{ width: (100 * it.value / top) + '%' }")
    span.val {{ it.text ?? it.value }}
</template>
