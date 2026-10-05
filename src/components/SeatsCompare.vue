<script setup vapor>
import { computed } from 'vue'
import { t } from '../i18n'
import { int, pct, signed } from '../format'
import { compare } from '../seats/calc'
import { candidateName } from '../seats/present'
import DataTable from './DataTable.vue'
import Notice from './Notice.vue'

// The calculated seats against the official elected list (table elected). A difference is explained by what the data can tell: the
// other rule gives the official list, the count is partial, or neither (candidacies and annulments the dump cannot see).
const props = defineProps({ result: Object, alt: Object, altRule: String, official: Array, names: Object, uf: String, input: Object, partial: Boolean })
const numbers = computed(() => props.official.map((c) => c.n))
const diff = computed(() => compare(props.result, numbers.value))
const cause = computed(() => (props.alt && compare(props.alt, numbers.value).equal ? 'rule' : props.partial ? 'partial' : 'data'))
const gap = computed(() => props.result.validVotes - props.input.officialVotes)
const party = (n) => props.result.blocs.flatMap((b) => b.parties).find((p) => p.party === n.slice(0, 2))?.sigla
const row = (side, n, votes, sigla) => ({ side, n, candidate: `${candidateName(props.names, props.uf, n)} · ${n}`, party: sigla, votes })
const rows = computed(() => [
  ...diff.value.onlyCalculated.map((n) => row(t('seats.compare.calculated'), n, props.result.elected.find((c) => c.n === n).votes, party(n))),
  ...diff.value.onlyOfficial.map((n) => row(t('seats.compare.officialSide'), n, props.official.find((c) => c.n === n).votes, props.official.find((c) => c.n === n).party)),
])
const cols = computed(() => [
  { key: 'side', label: t('seats.compare.side') },
  { key: 'candidate', label: t('seats.elected.candidate') },
  { key: 'party', label: t('common.party') },
  { key: 'votes', label: t('common.votes'), num: true, fmt: int },
])
</script>

<template lang="pug">
Notice(v-if="!official.length" kind="info") {{ t('seats.compare.none') }}
template(v-else)
  Notice(v-if="diff.equal" kind="success") {{ t('seats.compare.same', { count: diff.agree }) }}
  template(v-else)
    Notice(kind="warning") {{ t('seats.compare.differs', { count: diff.onlyOfficial.length, agree: diff.agree }) }}
    DataTable(:columns="cols" :rows="rows")
    Notice {{ t(`seats.compare.cause.${cause}`, { rule: altRule }) }}
  p.muted {{ t('seats.compare.votes', { calculated: int(result.validVotes), official: int(input.officialVotes), gap: signed(gap), share: pct(result.validVotes / input.officialVotes, 2) }) }}
</template>
