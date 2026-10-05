<script setup vapor>
// Primary or ghost button (design: components.css .btn); `label` is the accessible name of an icon-only button.
defineProps({ variant: { type: String, default: 'primary' }, disabled: Boolean, label: String })
</script>

<template lang="pug">
button.btn(type="button" :class="{ 'btn--ghost': variant === 'ghost' }" :disabled="disabled" :aria-label="label")
  slot
</template>
