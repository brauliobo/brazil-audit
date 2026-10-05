<script setup vapor>
import { computed } from 'vue'
import { ELECTIONS } from '../elections.js'
import { UFS } from '../model'
import { officeItems, stateTitle } from '../labels'
import { setParam } from '../router'
import ButtonGroup from '../components/ButtonGroup.vue'
import Field from '../components/Field.vue'
import { POS_OF } from './analysis'
import { GROUPS } from './data'
import { GROUP, POSITION, UNIT } from './keys'
import { UNITS } from './params'
import { t } from '../i18n'

// Every control writes its value to the URL query; a control that changes what the others can offer resets them.
// `p` is the effective state (with the default candidate resolved), `cands` = [{ cand, label, group }], `cities` = [name].
const props = defineProps({ p: Object, cands: Array, cities: Array, defaultMinN: Number })
const offices = computed(() => officeItems(ELECTIONS[props.p.election].offices))
const ufs = computed(() => UFS.map((s) => [s, stateTitle(s)]))
const units = computed(() => UNITS.map((u) => ({ value: u, label: t(UNIT[u].label), title: t(UNIT[u].hint) })))
const positions = computed(() => Object.entries(POS_OF).map(([key, pos]) => ({ value: key, label: t(POSITION[pos]) })))
const groups = computed(() => GROUPS.map((g) => ({ g, items: props.cands.filter((c) => c.group === g) })).filter((x) => x.items.length))
const cityPlace = computed(() => props.p.unit === 'section' && props.p.uf !== 'br')

const reset = (...names) => names.forEach((n) => setParam(n, null))
function office(id) {
  setParam('office', id)
  reset('cand')
  if (id === 8) setParam('place', 'df') // the district deputy only exists in the DF
}
const unit = (value) => { setParam('unit', value); if (value === 'uf') setParam('place', 'br') }
const uf = (e) => { setParam('place', e.target.value); if (+props.p.office > 1) reset('cand') }
const city = (e) => setParam('place', e.target.value ? `${props.p.uf}/${e.target.value}` : props.p.uf)
const minn = (e) => setParam('minn', e.target.value || null)
</script>

<template lang="pug">
form.cluster.bf-controls(:aria-label="t('benford.controls.label')" @submit.prevent)
  ButtonGroup(:label="t('common.office')" :items="offices" :value="p.office" @change="office")
  Field(:label="t('benford.controls.cand')")
    select(@change="setParam('cand', $event.target.value)")
      optgroup(v-for="x in groups" :key="x.g" :label="t(GROUP[x.g])")
        option(v-for="c in x.items" :key="c.cand" :value="c.cand" :selected="c.cand === p.cand") {{ c.label }}
  ButtonGroup(:label="t('benford.controls.unit')" :items="units" :value="p.unit" @change="unit")
  Field(:label="t('benford.controls.place')")
    select(:disabled="p.unit === 'uf'" @change="uf")
      option(value="br" :selected="p.uf === 'br'") {{ t('common.brazil') }}
      option(v-for="[s, title] in ufs" :key="s" :value="s" :selected="s === p.uf") {{ title }}
  Field(v-if="cityPlace" :label="t('common.city')")
    select(@change="city")
      option(value="" :selected="!p.city") {{ t('benford.controls.wholeUf') }}
      option(v-for="c in cities" :key="c" :value="c" :selected="c === p.city") {{ c }}
  ButtonGroup(:label="t('benford.controls.digits')" :items="positions" :value="p.digits" @change="setParam('digits', $event)")
  Field(:label="t('benford.controls.minn')")
    input.bf-minn(type="number" min="1" step="1" :value="p.minnGiven ? p.minn : ''" :placeholder="defaultMinN" @change="minn")
</template>
