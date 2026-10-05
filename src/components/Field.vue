<script setup vapor>
// A labelled form control: <Field label="Cargo"><select>…</select></Field>.
defineProps({ label: String })
</script>

<template lang="pug">
label.field
  | {{ label }}
  slot
</template>
