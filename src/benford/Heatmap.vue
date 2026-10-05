<script setup vapor>
import { computed } from 'vue'
import { int, num } from '../format'
import { stateName } from '../labels'
import { t } from '../i18n'

// UF x digit table coloured by the deviation of each digit. The number is always in the cell, the colour only reinforces the sign.
// rows = [{ uf, result }] (result: analysis of that UF), metric: 'z' (against Benford) | 'adj' (against the simulated baseline).
const props = defineProps({ rows: Array, metric: String, link: Function })
const SCALE = { z: 6, adj: 6, rel: 0.5 } // |value| at which the colour is at full strength

const value = (res, i) => {
  if (props.metric === 'z') return res.z[i].z
  if (props.metric === 'rel') return res.props[i] / res.probs[i] - 1
  const b = res.baseline?.digits?.[i]
  const sd = b ? (b.hi - b.lo) / 3.92 : 0
  return sd > 0 ? (res.props[i] - b.mean) / sd : null
}
const text = (v) => (v == null ? '–' : props.metric === 'rel' ? `${v >= 0 ? '+' : ''}${num(v * 100, 0)}%` : `${v >= 0 ? '+' : ''}${num(v, 1)}`)
const cells = computed(() => props.rows.map((r) => ({
  uf: r.uf, n: r.result.n, small: r.result.small, link: props.link(r.uf),
  values: r.result.digits.map((_, i) => {
    const v = r.result.n ? value(r.result, i) : null
    return { text: text(v), side: v == null ? '' : v >= 0 ? 'pos' : 'neg', k: v == null ? 0 : Math.min(Math.abs(v) / SCALE[props.metric], 1) }
  }),
})))
const digits = computed(() => props.rows[0].result.digits)
</script>

<template lang="pug">
.table-wrap(v-if="rows.length" tabindex="0" role="region" :aria-label="t('benford.heatmap.title')")
  table.table.bf-heat
    caption {{ t('benford.heatmap.title') }}
    thead
      tr
        th(scope="col") {{ t('common.state') }}
        th.num(scope="col") {{ t('benford.stats.n') }}
        th.num(v-for="d in digits" :key="d" scope="col") {{ d }}
    tbody
      tr(v-for="c in cells" :key="c.uf" :class="{ small: c.small }")
        th(scope="row")
          a(:href="c.link" :title="stateName(c.uf)") {{ c.uf.toUpperCase() }}
        td.num {{ int(c.n) }}
        td.num(v-for="(x, i) in c.values" :key="i" :class="x.side" :style="{ '--k': x.k }" :aria-label="`${c.uf.toUpperCase()}, ${digits[i]}: ${x.text}`") {{ x.text }}
p(v-else) {{ t('benford.heatmap.empty') }}
.legend(v-if="rows.length")
  span.legend__item
    i.legend__swatch.bf-swatch--down
    | ▼ {{ t('benford.heatmap.below') }}
  span.legend__item
    i.legend__swatch.bf-swatch--up
    | ▲ {{ t('benford.heatmap.above') }}
  span.muted {{ t('benford.heatmap.small') }}: {{ t('benford.heatmap.smallHint') }}
</template>
