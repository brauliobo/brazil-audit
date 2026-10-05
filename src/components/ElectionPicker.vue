<script setup vapor>
import { computed } from 'vue'
import { ELECTIONS } from '../model'
import { go, href, route } from '../router'
import { t } from '../i18n'

// Year select plus a turn toggle (shown only when the year has more than one turn); both keep the current view and its path arguments.
const all = Object.values(ELECTIONS)
const years = [...new Set(all.map((e) => e.year))]
const current = computed(() => ELECTIONS[route.value.election])
const turns = computed(() => all.filter((e) => e.year === current.value.year))
const to = (key) => href(key, route.value.view, route.value.args)
const pickYear = (e) => {
  const same = all.filter((x) => x.year === +e.target.value)
  go(to((same.find((x) => x.turn === current.value.turn) ?? same[0]).key))
}
</script>

<template lang="pug">
.picker
  select.control(:aria-label="t('election.year')" @change="pickYear")
    option(v-for="y in years" :key="y" :value="y" :selected="y === current.year") {{ y }}
  nav.segmented(v-if="turns.length > 1" :aria-label="t('election.round')")
    a(v-for="e in turns" :key="e.key" :href="to(e.key)" :title="t('election.turn', e)" :aria-label="t('election.turn', e)" :aria-current="e.key === current.key ? 'page' : null") {{ t('election.turnShort', e) }}
</template>
