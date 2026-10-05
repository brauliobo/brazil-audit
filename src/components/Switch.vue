<script setup vapor>
// A labelled checkbox used as an on/off switch.
defineProps({ label: String, checked: Boolean, hint: String })
const emit = defineEmits(['change'])
</script>

<template lang="pug">
label.switch(:title="hint")
  input(type="checkbox" :checked="checked" @change="emit('change', $event.target.checked)")
  | {{ label }}
</template>
