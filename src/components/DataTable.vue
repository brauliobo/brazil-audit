<script setup vapor>
import { computed } from 'vue'
import { t } from '../i18n'
import Button from './Button.vue'

// columns: [{ key, label, num?, fmt?(value,row), href?(row), sortable?, sort? }] (`sort` names the column in the sort state, default key);
// rows with `residual` are marked notes.
const props = defineProps({ columns: Array, rows: Array, sort: Object, page: { type: Number, default: 0 }, size: Number, total: Number })
const emit = defineEmits(['sort', 'page'])
const pages = computed(() => (props.size ? Math.ceil(props.total / props.size) : 1))
const show = (c, r) => (c.fmt ? c.fmt(r[c.key], r) : r[c.key] ?? '–')
const sorted = (c) => props.sort?.key === (c.sort ?? c.key)
const arrow = (c) => (sorted(c) ? (props.sort.dir === 'asc' ? '▲' : '▼') : '')
const ariaSort = (c) => (!c.sortable ? null : sorted(c) ? (props.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none')
</script>

<template lang="pug">
.table-wrap(tabindex="0" role="region" :aria-label="t('common.resultsTable')")
  table.table
    thead
      tr
        th(v-for="c in columns" :key="c.key" :class="{ num: c.num }" :aria-sort="ariaSort(c)")
          button.th-sort(v-if="c.sortable" type="button" @click="emit('sort', c.sort ?? c.key)") {{ c.label }} {{ arrow(c) }}
          template(v-else) {{ c.label }}
    tbody
      tr(v-for="(r, i) in rows" :key="i" :class="{ note: r.residual }")
        td(v-for="c in columns" :key="c.key" :class="{ num: c.num }")
          a(v-if="c.href && c.href(r)" :href="c.href(r)") {{ show(c, r) }}
          template(v-else) {{ show(c, r) }}
.pager(v-if="pages > 1")
  Button(variant="ghost" :disabled="page === 0" :label="t('common.prevPage')" @click="emit('page', page - 1)") ‹
  span {{ page + 1 }} / {{ pages }}
  Button(variant="ghost" :disabled="page + 1 >= pages" :label="t('common.nextPage')" @click="emit('page', page + 1)") ›
</template>
