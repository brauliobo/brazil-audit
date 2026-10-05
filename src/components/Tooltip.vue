<script setup vapor>
// Floating text box positioned by its parent (maps). pointer-events: none, so it never blocks the map.
defineProps({ text: String, x: Number, y: Number, show: Boolean })
</script>

<template lang="pug">
.tooltip(v-show="show" role="tooltip" :style="{ left: x + 'px', top: y + 'px' }") {{ text }}
</template>
