<script setup vapor>
// A legend row: items = [{ color, label }] (color is a CSS value, e.g. var(--cat-3)); extra content goes in the slot.
defineProps({ items: { type: Array, default: () => [] } })
</script>

<template lang="pug">
.legend
  span.legend__item(v-for="(it, i) in items" :key="i")
    i.legend__swatch(:style="{ background: it.color }")
    | {{ it.label }}
  slot
</template>
