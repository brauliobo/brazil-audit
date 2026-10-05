<script setup vapor>
import { residualOn } from '../results'
import { setParam } from '../router'
import Switch from './Switch.vue'

// 2026 only: totals at national, UF and city level may include the official totals of sections without published files.
const HINT = 'Soma aos totais nacionais, de UF e de município os votos que o total oficial (da zona ou do município) tem a mais que as seções com arquivo publicado. Não há detalhe por seção, então seções e as análises por seção não os incluem.'
</script>

<template lang="pug">
Switch(label="Incluir votos de seções sem arquivo (total oficial do município)" :hint="HINT" :checked="residualOn" @change="setParam('residual', $event ? null : '0')")
</template>
