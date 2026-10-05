<script setup vapor>
import { computed } from 'vue'
import { t } from '../i18n'
import { int, num } from '../format'
import { blocLabel, candidateName } from '../seats/present'
import DataTable from './DataTable.vue'

// Step 3: the sobras, seat by seat. Each round gives the next seat to the list with the highest average (votes / (seats held + 1),
// CE art. 109); the phases of the rule say which lists and candidates may take part (80% of the QE, 20% of the QE...).
const props = defineProps({ result: Object, rule: Object, unit: String, names: Object, uf: String })
const label = computed(() => Object.fromEntries(props.result.blocs.map((b) => [b.bloc, blocLabel(b, props.unit)])))
const phaseText = (i) => t('seats.rounds.phaseRule', { party: props.rule.phases[i].party, candidate: props.rule.phases[i].candidate, phase: i + 1 })
const summary = computed(() => props.result.rounds.map((r) => ({
  round: r.round, phase: r.phase + 1, winner: label.value[r.winner], candidate: candidateName(props.names, props.uf, r.candidate), average: r.rows.find((x) => x.bloc === r.winner).average,
  next: r.rows.find((x) => x.eligible && x.bloc !== r.winner), tie: r.tie,
})))
const cols = computed(() => [
  { key: 'round', label: t('seats.rounds.round'), num: true },
  { key: 'phase', label: t('seats.rounds.phase'), num: true },
  { key: 'winner', label: t('seats.rounds.winner') },
  { key: 'candidate', label: t('seats.rounds.candidate') },
  { key: 'average', label: t('seats.rounds.average'), num: true, fmt: (v) => num(v, 1) },
  { key: 'next', label: t('seats.rounds.next'), fmt: (v) => (v ? `${label.value[v.bloc]} · ${num(v.average, 1)}` : '–') },
])
const roundCols = computed(() => [
  { key: 'bloc', label: t('seats.blocs.list'), fmt: (v) => label.value[v] },
  { key: 'votes', label: t('seats.blocs.votes'), num: true, fmt: int },
  { key: 'held', label: t('seats.rounds.held'), num: true, fmt: int },
  { key: 'average', label: t('seats.rounds.average'), num: true, fmt: (v) => num(v, 1) },
  { key: 'reason', label: t('seats.rounds.status'), fmt: (v, r) => (r.bloc === r.win ? t('seats.rounds.takes') : v ? t(`seats.reason.${v}`) : t('seats.rounds.waits')) },
])
const rowsOf = (r) => r.rows.map((x) => ({ ...x, win: r.winner }))
</script>

<template lang="pug">
p(v-if="result.noQuotient") {{ t('seats.rounds.noQuotient') }}
p(v-else-if="!result.rounds.length") {{ t('seats.rounds.none') }}
template(v-else)
  ul.muted
    li(v-for="(p, i) in rule.phases" :key="i") {{ phaseText(i) }}
  DataTable(:columns="cols" :rows="summary")
  details.rounds
    summary {{ t('seats.rounds.averages') }}
    section(v-for="r in result.rounds" :key="r.round")
      h3 {{ t('seats.rounds.title', { round: r.round, phase: r.phase + 1 }) }}
      DataTable(:columns="roundCols" :rows="rowsOf(r)")
p.muted(v-if="result.lastSeat") {{ t('seats.rounds.lastSeat', { winner: label[result.lastSeat.winner], runnerUp: label[result.lastSeat.runnerUp], votes: int(result.lastSeat.votesBehind) }) }}
</template>
