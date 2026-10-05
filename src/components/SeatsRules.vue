<script setup vapor>
import { t } from '../i18n'
import { RULES } from '../seats/rules'

// What each rule says and where it comes from; `own` is the rule of the election, `current` the one the page applies.
defineProps({ own: String, current: String })
const rules = Object.values(RULES)
</script>

<template lang="pug">
p {{ t('seats.rules.intro') }}
section(v-for="r in rules" :key="r.id")
  h3 {{ t(`seats.ruleName.${r.id}`) }}
  p.muted(v-if="r.id === own") {{ t('seats.rules.own') }}
  p.muted(v-else-if="r.id === current") {{ t('seats.rules.applied') }}
  p {{ t(`seats.ruleText.${r.id}`) }}
  ul
    li(v-for="s in r.sources" :key="s.id")
      a(:href="s.url" rel="noopener") {{ t(`seats.sources.${s.id}`) }}
</template>
