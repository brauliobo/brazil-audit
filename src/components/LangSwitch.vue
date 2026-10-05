<script setup vapor>
import { LOCALES, chooseLocale, locale, t } from '../i18n'
</script>

<template lang="pug">
.segmented(role="group" :aria-label="t('lang.label')")
  button(v-for="l in LOCALES" :key="l" type="button" :lang="l" :aria-pressed="locale === l" :title="t(`lang.${l}`)" :aria-label="t(`lang.${l}`)" @click="chooseLocale(l)") {{ l.slice(0, 2).toUpperCase() }}
</template>
