<script setup vapor>
import { computed } from 'vue'
import { t } from '../i18n'
import { int, num } from '../format'

// Step 1: valid votes, seats and the quociente eleitoral (CE art. 106), with the minimums the rule derives from it.
const props = defineProps({ result: Object, rule: Object })
const sum = (key) => props.result.blocs.reduce((n, b) => n + b[key], 0)
const lost = computed(() => props.result.blocs.reduce((n, b) => n + b.annulled.reduce((m, v) => m + v.votes, 0), 0) + props.result.unmatched)
const rounding = computed(() => {
  const fraction = props.result.quotient.exact - Math.floor(props.result.quotient.exact)
  return fraction === 0 ? 'exact' : fraction > 0.5 ? 'up' : 'down'
})
const sobras = computed(() => props.rule.phases[0])
</script>

<template lang="pug">
p.muted {{ t('seats.q.alias') }}
dl.calc
  div
    dt {{ t('seats.q.nominal') }}
    dd {{ int(sum('nominal')) }}
  div
    dt {{ t('seats.q.legend') }}
    dd {{ int(sum('legend')) }}
  div
    dt {{ t('seats.q.valid') }}
    dd {{ int(sum('nominal')) }} + {{ int(sum('legend')) }} = {{ int(result.validVotes) }}
  div
    dt {{ t('seats.q.seats') }}
    dd {{ int(result.seats) }}
  div
    dt {{ t('seats.q.quotient') }}
    dd {{ int(result.validVotes) }} ÷ {{ int(result.seats) }} = {{ num(result.quotient.exact, 2) }} → {{ int(result.quotient.value) }}
  div
    dt {{ t('seats.q.candidateMin', { share: rule.candidate }) }}
    dd {{ int(result.quotient.candidateMin) }}
  div(v-if="sobras.party")
    dt {{ t('seats.q.partyMin', { share: sobras.party }) }}
    dd {{ int(result.quotient.partyMin) }}
p.muted {{ t(`seats.q.rounding.${rounding}`) }}
p.muted {{ t('seats.q.excluded', { n: int(lost) }) }}
</template>
