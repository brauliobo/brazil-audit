<script setup vapor>
// Trail of links ending with the current place; the `end` slot holds a related action (e.g. "ver detalhamento").
defineProps({ items: Array, label: { type: String, default: 'Navegação' } })
</script>

<template lang="pug">
nav.breadcrumb(:aria-label="label")
  template(v-for="(it, i) in items" :key="i")
    span.breadcrumb__sep(v-if="i" aria-hidden="true") ›
    b(v-if="i === items.length - 1" aria-current="page") {{ it.label }}
    a(v-else :href="it.href") {{ it.label }}
  .breadcrumb__end
    slot(name="end")
</template>
