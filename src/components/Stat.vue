<script setup vapor>
// A headline number with its label (KPI).
defineProps({ value: [String, Number], label: String })
</script>

<template lang="pug">
.stat
  span.stat__value {{ value }}
  span.stat__label {{ label }}
</template>
