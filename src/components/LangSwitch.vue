<script setup vapor>
import { computed } from 'vue'
import { LOCALES, chooseLocale, locale, t } from '../i18n'
import ButtonGroup from './ButtonGroup.vue'

const items = computed(() => LOCALES.map((l) => ({ value: l, label: l.slice(0, 2).toUpperCase(), title: t(`lang.${l}`) })))
</script>

<template lang="pug">
ButtonGroup(compact :label="t('lang.label')" :items="items" :value="locale" @change="chooseLocale")
</template>
