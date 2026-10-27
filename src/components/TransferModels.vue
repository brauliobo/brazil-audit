<script setup vapor>
import {computed,ref} from 'vue'
import {transferIndex} from '../transfers'
import {useAsync} from '../use'
import {cachedFetch} from '../db/fetching'
import {t} from '../i18n'
import Field from './Field.vue'
import Panel from './Panel.vue'
const models=transferIndex?.models ?? []
const selectedId=ref(models[0]?.id)
const selected=computed(()=>models.find(m=>m.id===selectedId.value))
const artifactHref=computed(()=>selected.value?`${import.meta.env.BASE_URL}data/${selected.value.url}?v=${selected.value.sha256}`:'')
const data=useAsync(()=>[selected.value?.id],async()=>selected.value ? (await cachedFetch(`${import.meta.env.BASE_URL}data/${selected.value.url}`,selected.value.sha256)).json() : null)
</script>
<template lang="pug">
p.muted {{ t('compare.modelsSlowNote') }}
Field(v-if="models.length" :label="t('compare.election')")
  select(v-model="selectedId")
    option(v-for="m in models" :key="m.id" :value="m.id") {{ m.year }} · {{ t(`compare.flowOffices.${m.office}`) }} · {{ m.state.toUpperCase() }}
Panel(v-if="selected" :title="t('compare.modelsTitle')" :state="data" wide)
  template(v-if="data.data")
    p {{ t(`compare.flowStatus.${data.data.status}`) }}
    p(v-if="data.data.method?.grain") {{ t('compare.modelScope') }} · {{ t(`compare.flowGrains.${data.data.method.grain}`) }}
    p(v-if="data.data.reason") {{ t(`compare.flowReasons.${data.data.reason}`) }}
    ul(v-if="data.data.diagnostics?.failedChecks?.length > 1")
      li(v-for="check in data.data.diagnostics.failedChecks.filter((c) => c !== data.data.reason)" :key="check") {{ t(`compare.flowReasons.${check}`) }}
    pre {{ JSON.stringify(data.data.diagnostics,null,2) }}
    details(v-for="m in data.data.models" :key="m.id")
      summary {{ m.id }} · {{ t(`compare.flowStatus.${m.status}`) }}
      pre {{ JSON.stringify(m.diagnostics,null,2) }}
    a.btn.btn--ghost(:href="artifactHref" :download="`${selected.id}.json`") {{ t('compare.flowDownloadJSON') }}
</template>
