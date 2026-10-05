<script setup vapor>
// Primary or ghost button (design: components.css .btn). `to` renders it as a link with the same look.
defineProps({ variant: { type: String, default: 'primary' }, disabled: Boolean })
</script>

<template lang="pug">
button.btn(type="button" :class="{ 'btn--ghost': variant === 'ghost' }" :disabled="disabled")
  slot
</template>
