<script setup vapor>
import { computed } from 'vue'

// columns: [{ key, label, num?, fmt?(value,row), href?(row), sortable? }]
const props = defineProps({ columns: Array, rows: Array, sort: Object, page: { type: Number, default: 0 }, size: Number, total: Number })
const emit = defineEmits(['sort', 'page'])
const pages = computed(() => (props.size ? Math.ceil(props.total / props.size) : 1))
const show = (c, r) => (c.fmt ? c.fmt(r[c.key], r) : r[c.key] ?? '–')
const arrow = (c) => (props.sort?.key === c.key ? (props.sort.dir === 'asc' ? '▲' : '▼') : '')
</script>

<template lang="pug">
.table-wrap
  table
    thead
      tr
        th(v-for="c in columns" :key="c.key" :class="{ num: c.num, sortable: c.sortable }" @click="c.sortable && emit('sort', c.key)") {{ c.label }} {{ arrow(c) }}
    tbody
      tr(v-for="(r, i) in rows" :key="i")
        td(v-for="c in columns" :key="c.key" :class="{ num: c.num }")
          a(v-if="c.href" :href="c.href(r)") {{ show(c, r) }}
          template(v-else) {{ show(c, r) }}
  .pager(v-if="pages > 1")
    button(:disabled="page === 0" @click="emit('page', page - 1)") ‹
    span {{ page + 1 }} / {{ pages }}
    button(:disabled="page + 1 >= pages" @click="emit('page', page + 1)") ›
</template>
