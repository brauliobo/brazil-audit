<script setup vapor>
import { computed } from 'vue'
import { ELECTIONS, selectedOffice } from '../model'
import { contextParams } from '../election-registry'
import { route, go, href } from '../router'
import { t } from '../i18n'
import Field from './Field.vue'
const props = defineProps({ states: Array, state: String, cities: Array })
const cfg = computed(() => ELECTIONS[route.value.election])
const office = computed(() => selectedOffice(route.value.election,route.value.params.get('office')))
const pickOffice = (e) => {
  const params = contextParams(route.value.election,{...Object.fromEntries(route.value.params),office:e.target.value})
  delete params.cand; delete params.city
  go(href(route.value.election,route.value.view,route.value.args,params))
}
const pickState = (event) => {
  const params = {...Object.fromEntries(route.value.params),state:event.target.value}
  delete params.city; delete params.cand
  go(href(route.value.election,route.value.view,route.value.args,params))
}
</script>
<template lang="pug">
.cluster
  Field(:label="t('common.office')")
    select(:value="office.key" @change="pickOffice")
      option(v-for="o in cfg.officeDefinitions" :key="o.key" :value="o.key" :selected="o.key === office.key") {{ o.name }}
  Field(v-if="states?.length" :label="t('common.state')")
    select(:value="state ?? route.params.get('state') ?? ''" @change="pickState")
      option(value="" :selected="(props.state ?? route.params.get('state') ?? '') === ''") {{ t('common.brazil') }}
      option(v-for="state in states" :key="state" :value="state" :selected="state === (props.state ?? route.params.get('state'))") {{ state.toUpperCase() }}
  Field(v-if="cities?.length" :label="t('common.city')")
    select(:value="route.params.get('city') ?? ''" @change="go(href(route.election,route.view,route.args,{...Object.fromEntries(route.params),city:$event.target.value}))")
      option(value="" :selected="!route.params.get('city')") {{ t('common.all') }}
      option(v-for="city in cities" :key="city.city_code" :value="city.city_code" :selected="city.city_code === route.params.get('city')") {{ city.city_name }} · {{ city.city_code }}
</template>
