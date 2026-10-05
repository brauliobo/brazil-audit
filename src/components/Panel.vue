<script setup vapor>
import { href } from '../router'
import { ms } from '../format'

// `state` is a useAsync()/useQuery() result: drives the skeleton, the error box and the query-time badge.
defineProps({ title: String, state: Object, election: String, wide: Boolean })
</script>

<template lang="pug">
section.panel(:class="{ wide }")
  header
    h2 {{ title }}
    span.ms(v-if="state && state.sqls.length" :class="{ stale: state.loading }") {{ state.loading ? '…' : ms(state.ms) }}
  .error(v-if="state && state.error")
    strong {{ state.error.message }}
    pre(v-if="state.error.detail") {{ state.error.detail }}
  .skeleton(v-else-if="state && !state.data")
  .body(v-else)
    slot
  details.sql(v-if="state && state.sqls.length")
    summary SQL
    div(v-for="(q, i) in state.sqls" :key="i")
      pre {{ q.sql }}
      a(:href="href(election, 'sql', [], { q: q.sql })") abrir no console
</template>
