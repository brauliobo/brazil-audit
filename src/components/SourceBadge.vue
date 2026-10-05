<script setup vapor>
import { computed } from 'vue'
import { ELECTIONS } from '../model'
import { href } from '../router'
import { residualOn } from '../results'
import { t } from '../i18n'

// A short line under a view's title: which source layer its numbers come from, linking to the Sources panel of the overview.
// view: what the numbers are (votes by candidate, seats, voting times); the answer follows the election's `sources`.
const props = defineProps({ election: String, view: { type: String, default: 'votes' } })
const el = computed(() => ELECTIONS[props.election])
const kind = computed(() => {
  const s = el.value.sources
  if (props.view === 'times') return s.logs ? 'logs' : null
  if (props.view === 'seats' && s.official.includes('residual')) return 'officialFiles'
  if (s.rdv) return props.view === 'votes' && residualOn.value ? 'rdvOfficial' : 'rdv'
  return s.pending.length ? 'openPending' : 'open'
})
</script>

<template lang="pug">
p.source-line(v-if="kind")
  a.badge.badge--source(:href="`${href(election, 'overview')}#fontes`") {{ t(`sources.badge.${kind}`) }}
</template>
