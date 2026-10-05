<script setup vapor>
// Inline message: note (neutral), info, warning, danger or success. Colour is never the only signal: the text says what it is.
defineProps({ kind: { type: String, default: 'note' } })
</script>

<template lang="pug">
p.notice(:class="`notice--${kind}`" :role="kind === 'danger' ? 'alert' : null")
  slot
</template>
