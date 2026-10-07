<script setup vapor>
import { href } from '../router'
import { ms } from '../format'
import { t } from '../i18n'
import Skeleton from './Skeleton.vue'
import Notice from './Notice.vue'

// `state` is a useAsync()/useQuery() result: drives the skeleton, the error box and the query-time badge.
defineProps({ title: String, state: Object, election: String, wide: Boolean, chart: Boolean }) // chart: the loading placeholder is as tall as a chart, so the panels below do not jump when it arrives
</script>

<template lang="pug">
section.panel(:class="{ 'span-all': wide, 'panel--chart': chart }")
  header.panel__header
    h2(tabindex="-1") {{ title }}
    span.panel__badge(v-if="state && state.sqls.length" :class="{ 'panel__badge--stale': state.loading }") {{ state.loading ? '…' : ms(state.ms) }}
  Notice(v-if="state && state.error" kind="danger")
    strong {{ state.error.message }}
    pre(v-if="state.error.detail") {{ state.error.detail }}
  Skeleton(v-else-if="state && !state.data")
  .body(v-else)
    slot
  details.panel__sql(v-if="state && state.sqls.length")
    summary SQL
    div(v-for="(q, i) in state.sqls" :key="i")
      pre {{ q.sql }}
      a(:href="href(election, 'sql', [], { q: q.sql })") {{ t('common.openInConsole') }}
</template>
