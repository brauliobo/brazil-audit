<script setup vapor>
import { computed } from 'vue'
import { ELECTIONS, selectedOffice } from '../model'
import { route, setParam } from '../router'
import { t } from '../i18n'
import Field from './Field.vue'
const props = defineProps({ states: Array })
const cfg = computed(() => ELECTIONS[route.value.election])
const office = computed(() => selectedOffice(route.value.election,route.value.params.get('office')))
const pickOffice = (e) => { setParam('office',e.target.value); setParam('cand',null) }
</script>
<template lang="pug">
.cluster
  Field(:label="t('common.office')")
    select(:value="office.key" @change="pickOffice")
      option(v-for="o in cfg.officeDefinitions" :key="o.key" :value="o.key" :selected="o.key === office.key") {{ o.name }}
  Field(v-if="states?.length" :label="t('common.state')")
    select(:value="route.params.get('state') ?? ''" @change="setParam('state',$event.target.value)")
      option(value="") {{ t('common.brazil') }}
      option(v-for="state in states" :key="state" :value="state" :selected="state === route.params.get('state')") {{ state.toUpperCase() }}
</template>
