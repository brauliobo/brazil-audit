<script setup vapor>
import { computed } from 'vue'
import { ELECTIONS, ELECTION_LIST } from '../model'
import { go, href, route } from '../router'
import { t } from '../i18n'
import ButtonGroup from './ButtonGroup.vue'

// Year buttons plus a round group (shown only when the year has more than one round); both keep the current view and its path
// arguments. Choosing loads data, so the arrows only move the focus (manual activation).
const years = [...new Set(ELECTION_LIST.map((e) => e.year))]
const current = computed(() => ELECTIONS[route.value.election])
const turns = computed(() => ELECTION_LIST.filter((e) => e.year === current.value.year))
const to = (key) => href(key, route.value.view, route.value.args)
const pickYear = (year) => {
  const same = ELECTION_LIST.filter((e) => e.year === year)
  go(to((same.find((e) => e.turn === current.value.turn) ?? same[0]).key))
}
const yearItems = years.map((year) => ({ value: year, label: String(year) }))
const turnItems = computed(() => turns.value.map((e) => ({ value: e.key, label: t('election.turnShort', e), title: t('election.turn', e) })))
</script>

<template lang="pug">
.picker
  ButtonGroup(compact manual :label="t('election.year')" :items="yearItems" :value="current.year" @change="pickYear")
  ButtonGroup(v-if="turns.length > 1" compact manual :label="t('election.round')" :items="turnItems" :value="current.key" @change="(key) => go(to(key))")
</template>
