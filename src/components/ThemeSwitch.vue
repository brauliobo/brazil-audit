<script setup vapor>
import { computed } from 'vue'
import { THEMES } from '../model'
import { setTheme, theme } from '../theme'
import { t } from '../i18n'
import ButtonGroup from './ButtonGroup.vue'

// Light / system / dark. The icons are stroke paths on a 16px grid (system = the half-filled circle).
const ICONS = {
  light: ['M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z', 'M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1'],
  system: ['M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2z', 'M8 2v12'],
  dark: ['M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7z'],
}
const items = computed(() => THEMES.map((name) => ({ value: name, title: t(`theme.${name}`), icon: ICONS[name] })))
</script>

<template lang="pug">
ButtonGroup(compact :label="t('theme.label')" :items="items" :value="theme" @change="setTheme")
</template>
