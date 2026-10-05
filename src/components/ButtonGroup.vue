<script setup vapor>
import { computed } from 'vue'

// A labelled group of mutually exclusive buttons (radiogroup): the shared control for low-cardinality choices (office, metric, scale,
// round, language, theme). items = [{ value, label, title?, icon?: [svg path], disabled? }]; `change` carries the chosen value.
// Roving tabindex (one tab stop), arrows move and choose, Home/End jump; with `manual` the arrows only move the focus and
// Enter/Space choose (for choices that load data). The group is named by aria-label; `compact` hides the visible label.
const props = defineProps({ label: String, items: Array, value: [String, Number], compact: Boolean, manual: Boolean })
const emit = defineEmits(['change'])

const same = (item) => String(item.value) === String(props.value)
const tabStop = computed(() => (props.items.some(same) ? props.items.find(same) : props.items.find((i) => !i.disabled))?.value)

function onKey(e) {
  const buttons = [...e.currentTarget.querySelectorAll('button:not(:disabled)')]
  const at = buttons.indexOf(document.activeElement)
  const target = { ArrowRight: buttons[(at + 1) % buttons.length], ArrowDown: buttons[(at + 1) % buttons.length], ArrowLeft: buttons[(at - 1 + buttons.length) % buttons.length], ArrowUp: buttons[(at - 1 + buttons.length) % buttons.length], Home: buttons[0], End: buttons.at(-1) }[e.key]
  if (!target || at < 0) return
  e.preventDefault()
  target.focus()
  if (!props.manual) target.click()
}
</script>

<template lang="pug">
.btngroup
  span.btngroup__label(v-if="!compact" aria-hidden="true") {{ label }}
  .segmented(role="radiogroup" :class="{ 'segmented--compact': compact }" :aria-label="label" @keydown="onKey")
    button(v-for="item in items" :key="item.value" type="button" role="radio" :aria-checked="same(item)" :tabindex="item.value === tabStop ? 0 : -1" :disabled="item.disabled" :title="item.title ?? item.label" :aria-label="item.title" @click="emit('change', item.value)")
      svg(v-if="item.icon" viewBox="0 0 16 16" aria-hidden="true")
        path(v-for="d in item.icon" :key="d" :d="d")
      template(v-else) {{ item.label }}
</template>
