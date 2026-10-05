<script setup vapor>
import { computed } from 'vue'
import { int, num, pct } from '../format'
import { t } from '../i18n'
import { MAD_CLASS, VERDICT } from './keys'

// The measures of one scope and the reading that respects the simulated baseline.
const props = defineProps({ result: Object })
const r = computed(() => props.result)
const KIND = { small: 'note', nobase: 'note', inside: 'note', above: 'warning', below: 'info' } // notice kind of each verdict (text says it too)
const m = (x) => num(x, 4)
const outside = computed(() => r.value.outside?.filter(Boolean).length ?? 0)
const p = computed(() => (r.value.p < 1e-4 ? t('benford.stats.pTiny') : num(r.value.p, 4)))
const band = computed(() => r.value.baseline?.mad)
const rows = computed(() => (r.value.small && !r.value.n ? [] : [
  [t('benford.stats.n'), int(r.value.n), t('benford.stats.nHint')],
  [t('benford.stats.mad'), `${m(r.value.mad)} · ${r.value.madClass ? t(MAD_CLASS[r.value.madClass]) : t('benford.stats.madClassNone')}`, `${t('benford.stats.madHint')}; ${t('benford.stats.classHint')}`],
  [t('benford.stats.noise'), m(r.value.noise), t('benford.stats.noiseHint')],
  [`${t('benford.stats.chi2')} (${r.value.df} ${t('benford.stats.df')})`, `${num(r.value.chi2, 1)} · ${t('benford.stats.p')} ${p.value}`, null],
  ...(band.value ? [
    [t('benford.stats.baselineMad'), `${m(band.value.mean)} (${m(band.value.lo)} a ${m(band.value.hi)})`, t('benford.stats.baselineHint')],
    [t('benford.stats.delta'), `${r.value.mad - band.value.mean >= 0 ? '+' : ''}${m(r.value.mad - band.value.mean)}`, null],
    [t('benford.stats.excess'), r.value.excess == null ? t('benford.stats.none') : pct(r.value.excess, 1), t('benford.stats.excessHint')],
    [t('benford.stats.index'), r.value.index == null ? t('benford.stats.none') : num(r.value.index, 1), t('benford.stats.indexHint')],
    [t('benford.stats.digitsOutside'), `${outside.value} / ${r.value.digits.length}`, null],
  ] : []),
]))
const text = computed(() => {
  const v = r.value
  const vars = { n: int(v.n), min: int(v.minN), mad: m(v.mad ?? 0), lo: m(band.value?.lo ?? 0), hi: m(band.value?.hi ?? 0) }
  return t(VERDICT[v.verdict], vars)
})
</script>

<template lang="pug">
.bf-stats
  dl(v-if="rows.length")
    template(v-for="[label, value, hint] in rows" :key="label")
      dt(:title="hint ?? undefined") {{ label }}
      dd {{ value }}
  .notice.bf-verdict(:class="`notice--${KIND[result.verdict]}`" role="status")
    strong {{ t('benford.verdict.title') }}
    p {{ text }}
    p.muted(v-if="result.verdict === 'small'") {{ t('benford.verdict.smallWhy') }}
    p.muted(v-else-if="result.verdict !== 'nobase'") {{ t('benford.verdict.caveat') }}
</template>
