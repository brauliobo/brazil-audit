<script setup vapor>
// A small pill link, e.g. a state shortcut.
defineProps({ href: String })
</script>

<template lang="pug">
a.chip(:href="href")
  slot
</template>
