<script setup vapor>
import { computed } from 'vue'
import { route, href, setParam } from '../router'
import { ELECTIONS, SEATS_ELECTION } from '../model'
import { electionLabel, officeItems, officeName, stateName, stateOptions } from '../labels'
import { t } from '../i18n'
import { useAsync } from '../use'
import { int, pct } from '../format'
import { residualOn } from '../results'
import { calculate, compare } from '../seats/calc'
import { RULES } from '../seats/rules'
import { loadSeats } from '../seats/load'
import { seatGroups } from '../seats/present'
import Panel from '../components/Panel.vue'
import ButtonGroup from '../components/ButtonGroup.vue'
import Field from '../components/Field.vue'
import Stat from '../components/Stat.vue'
import Notice from '../components/Notice.vue'
import Hemicycle from '../components/Hemicycle.vue'
import ResidualSwitch from '../components/ResidualSwitch.vue'
import SeatsQuotient from '../components/SeatsQuotient.vue'
import SeatsBlocs from '../components/SeatsBlocs.vue'
import SeatsRounds from '../components/SeatsRounds.vue'
import SeatsElected from '../components/SeatsElected.vue'
import SeatsCompare from '../components/SeatsCompare.vue'
import SeatsNational from '../components/SeatsNational.vue'
import SeatsRules from '../components/SeatsRules.vue'

// The seats of the deputy offices recomputed from the votes in the database: quociente eleitoral, quociente partidário, sobras by maior
// média, elected candidates, compared with the official list. The rule is a config entry per election (src/seats/rules.js); the page can
// apply another one to the same votes, and works on whatever votes are loaded (a partial count is a projection).
const year = computed(() => route.value.election)
const cfg = computed(() => ELECTIONS[year.value])
const param = (name) => route.value.params.get(name)
const offices = computed(() => [6, 7, 8].filter((o) => cfg.value.offices.includes(o)))
const office = computed(() => (offices.value.includes(+param('office')) ? +param('office') : 6))
// the district office is the DF's; the national chamber exists for the federal office only
const uf = computed(() => (office.value === 8 ? 'df' : office.value === 7 ? (['br', 'df'].includes(param('uf')) ? 'sp' : param('uf') ?? 'sp') : param('uf') ?? 'br'))
const national = computed(() => uf.value === 'br')
const ufs = computed(() => stateOptions(office.value === 7 ? ['df'] : []))
const rule = computed(() => RULES[param('rule')] ?? RULES[cfg.value.seatRule])
const own = computed(() => RULES[cfg.value.seatRule])
const unit = computed(() => own.value.unit)
const ruleItems = computed(() => Object.values(RULES).map((r) => ({ value: r.id, label: t(`seats.ruleShort.${r.id}`), title: `${t(`seats.ruleName.${r.id}`)} · ${r.id === own.value.id ? t('seats.rules.ownShort') : t('seats.rules.whatIf')}` })))
const params = computed(() => ({ office: office.value, rule: param('rule'), residual: param('residual') }))

const seats = useAsync(() => [year.value, office.value, uf.value, residualOn.value], ([y, o, u], q) => loadSeats(q, y, o, u === 'br' ? '' : u))
const calcAll = (r) => new Map([...seats.data.inputs].map(([u, input]) => [u, calculate(input, r)]))
const results = computed(() => seats.data && calcAll(rule.value))
const result = computed(() => results.value?.get(uf.value))
const input = computed(() => seats.data?.inputs.get(uf.value))
const alt = computed(() => (seats.data && !national.value ? calculate(input.value, RULES[rule.value.alternative]) : null))
const official = computed(() => seats.data?.official.get(uf.value) ?? [])

// how much of the official valid votes the calculation has, and how many UFs agree with the official list
const share = computed(() => [...results.value].reduce((n, [u, r]) => n + r.validVotes, 0) / [...seats.data.inputs.values()].reduce((n, i) => n + i.officialVotes, 0))
const agreeing = computed(() => [...results.value].filter(([u, r]) => compare(r, (seats.data.official.get(u) ?? []).map((c) => c.n)).equal).length)
const totalSeats = computed(() => [...results.value.values()].reduce((n, r) => n + r.seats, 0))
const partial = computed(() => share.value < 1)
const place = computed(() => (national.value ? t('common.brazil') : stateName(uf.value)))
const sections = computed(() => seats.data.coverage)
const groups = computed(() => seatGroups([...results.value.values()], { unit: unit.value, national: national.value }))
const pick = (name, value) => setParam(name, value === '' || (name === 'rule' && value === cfg.value.seatRule) ? null : value)
</script>

<template lang="pug">
h1 {{ t('seats.title', { election: electionLabel(year) }) }}
p.muted(v-if="!cfg.seatRule")
  | {{ t('seats.unavailable') }}&nbsp;
  a(:href="href(SEATS_ELECTION, 'seats')") {{ t('seats.seeAvailable', { election: electionLabel(SEATS_ELECTION) }) }}
template(v-else)
  p {{ t('seats.intro') }}
  .cluster
    ButtonGroup(:label="t('common.office')" :items="officeItems(offices)" :value="office" @change="pick('office', $event)")
    Field(v-if="office !== 8" :label="t('common.state')")
      select(@change="pick('uf', $event.target.value)")
        option(v-if="office === 6" value="br" :selected="national") {{ t('seats.national.option') }}
        option(v-for="[s, name] in ufs" :key="s" :value="s" :selected="s === uf") {{ name }}
    ButtonGroup(:label="t('seats.rule')" :items="ruleItems" :value="rule.id" @change="pick('rule', $event)")
    ResidualSwitch(v-if="cfg.hasResidual")
  Panel(:title="t('seats.summary', { place, office: officeName(office) })" :state="seats" :election="year" wide)
    Notice(v-if="rule.id !== own.id" kind="info") {{ t('seats.whatIfNote', { rule: t(`seats.ruleName.${rule.id}`), own: t(`seats.ruleName.${own.id}`) }) }}
    Notice(v-if="partial" kind="warning") {{ t('seats.projection', { share: pct(share, 1) }) }}
    Notice(v-else-if="sections.missing" kind="info") {{ t('seats.missing', { count: int(sections.missing) }) }}
    Notice(v-else kind="success") {{ t('seats.complete') }}
    .cluster
      Stat(:value="int(totalSeats)" :label="t('seats.stat.seats')")
      Stat(v-if="result" :value="int(result.validVotes)" :label="t('seats.stat.valid')")
      Stat(v-if="result" :value="int(result.quotient.value)" :label="t('seats.stat.quotient')")
      Stat(v-if="national" :value="`${agreeing} / ${results.size}`" :label="t('seats.stat.agreeing')")
      Stat(:value="pct(share, 1)" :label="t('seats.stat.counted')")
      Stat(v-if="sections.stored != null" :value="sections.own ? `${int(sections.stored)} / ${int(sections.own)}` : int(sections.stored)" :label="t('seats.stat.sections')")
    Hemicycle(v-if="result" :groups="groups" :label="t('seats.hemicycle', { place, count: result.seats })")
  template(v-if="seats.data")
    Panel(v-if="national" :title="t('seats.national.title')" :election="year" wide)
      SeatsNational(:results="results" :inputs="seats.data.inputs" :official="seats.data.official" :unit="unit" :election="year" :office="office" :params="params")
    template(v-else)
      .grid-auto
        Panel(:title="t('seats.step1')" :election="year")
          SeatsQuotient(:result="result" :rule="rule")
        Panel(:title="t('seats.step2')" :election="year")
          SeatsBlocs(:result="result" :unit="unit" :check="seats.data.check")
      Panel(:title="t('seats.step3')" :election="year" wide)
        SeatsRounds(:result="result" :rule="rule" :unit="unit" :names="seats.data.names" :uf="uf")
      Panel(:title="t('seats.step4')" :election="year" wide)
        SeatsElected(:result="result" :unit="unit" :names="seats.data.names" :uf="uf" :official="official")
      Panel(:title="t('seats.compare.title')" :election="year" wide)
        SeatsCompare(:result="result" :alt="alt" :alt-rule="t(`seats.ruleName.${rule.alternative}`)" :official="official" :names="seats.data.names" :uf="uf" :input="input" :partial="partial")
    Panel(:title="t('seats.rules.title')" :election="year" wide)
      SeatsRules(:own="own.id" :current="rule.id")
</template>
