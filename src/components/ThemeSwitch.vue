<script setup vapor>
import { THEMES } from '../model'
import { setTheme, theme } from '../theme'
import { t } from '../i18n'

// Light / system / dark. The icons are stroke paths on a 16px grid (system = the half-filled circle).
const ICONS = {
  light: ['M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z', 'M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1'],
  system: ['M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2z', 'M8 2v12'],
  dark: ['M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7z'],
}
</script>

<template lang="pug">
.segmented(role="group" :aria-label="t('theme.label')")
  button(v-for="name in THEMES" :key="name" type="button" :aria-pressed="theme === name" :title="t(`theme.${name}`)" :aria-label="t(`theme.${name}`)" @click="setTheme(name)")
    svg(viewBox="0 0 16 16" aria-hidden="true")
      path(v-for="d in ICONS[name]" :key="d" :d="d")
</template>
