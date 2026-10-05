<script setup vapor>
import { residualOn } from '../results'
import { setParam } from '../router'
import { t } from '../i18n'
import Switch from './Switch.vue'

// Totals at national, UF and city level may include the official totals of sections without published files.
</script>

<template lang="pug">
Switch(:label="t('residual.label')" :hint="t('residual.hint')" :checked="residualOn" @change="setParam('residual', $event ? null : '0')")
</template>
