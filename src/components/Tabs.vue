<script setup vapor>
// A row of navigation links with the current one marked: items = [{ href, label, current }].
defineProps({ items: Array, label: String })
</script>

<template lang="pug">
nav.tabs(:aria-label="label")
  a(v-for="it in items" :key="it.href" :href="it.href" :aria-current="it.current ? 'page' : null") {{ it.label }}
</template>
