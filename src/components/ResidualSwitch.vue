<script setup vapor>
import { residualOn } from '../results'
import { setParam } from '../router'

// 2026 only: totals at national, UF and city level may include the official municipality totals of sections without files.
const toggle = (e) => setParam('residual', e.target.checked ? null : '0')
</script>

<template lang="pug">
label.switch(title="Soma aos totais nacionais, de UF e de município os votos que o total oficial do município tem a mais que as seções com arquivo publicado. Não há detalhe por seção, então zonas, seções e as análises por seção não os incluem.")
  input(type="checkbox" :checked="residualOn" @change="toggle")
  | Incluir votos de seções sem arquivo (total oficial do município)
</template>
