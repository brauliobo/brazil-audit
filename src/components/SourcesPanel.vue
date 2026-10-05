<script setup vapor>
import { computed } from 'vue'
import { ELECTIONS } from '../model'
import { store } from '../data'
import { int, pct } from '../format'
import { t } from '../i18n'
import Notice from './Notice.vue'
import Panel from './Panel.vue'

// The layers of evidence in priority order and what each does for this election, read from `sources` in src/elections.js.
const props = defineProps({ election: String })
const el = computed(() => ELECTIONS[props.election])
const stateOf = (layer) => (el.value.sources[layer] ? 'used' : el.value.sources.pending.includes(layer) ? 'pending' : layer === 'open' && el.value.sources.rdv ? 'unused' : 'none')
const feeds = (layer) => ({ logs: 'vt, vtc', rdv: 'rdv, res, tot', open: 'rdv, res, tot', official: el.value.sources.official.map((o) => t(`sources.official.${o}`)).join('; ') })[layer] // i18n-ignore (table names)
const layers = computed(() => ['logs', 'rdv', 'open', 'official'].map((id) => ({ id, state: id === 'official' ? 'used' : stateOf(id) })))
// documented gaps against the official totals, and how the logs compare with the RDV (measured when the data was built)
const differences = computed(() => Object.entries(el.value.sources.differences).map(([reason, count]) => t(`sources.diff.${reason}`, { count })))
const logs = computed(() => store.manifest.sources?.[props.election]?.logsVsRdv)
const note = computed(() => (el.value.sources.pending.length ? t('sources.notePending') : !el.value.sources.rdv && !el.value.sources.logs ? t('sources.noteNone') : null))
</script>

<template lang="pug">
Panel#fontes(:title="t('sources.title')" wide)
  p.muted {{ t('sources.intro') }}
  ol.sources
    li(v-for="layer in layers" :key="layer.id")
      .sources__head
        b {{ t(`sources.layer.${layer.id}.name`) }}
        span.badge(:class="`badge--${layer.state}`") {{ t(`sources.state.${layer.state}`) }}
      p.muted {{ t(`sources.layer.${layer.id}.role`) }}
      p.muted(v-if="layer.state === 'used'") {{ t('sources.feeds', { tables: feeds(layer.id) }) }}
  Notice(v-if="note") {{ note }}
  template(v-if="differences.length")
    p.muted {{ t('sources.differences') }}
    ul.muted
      li(v-for="d in differences" :key="d") {{ d }}
  p.muted(v-if="el.hasTimes && logs") {{ t('sources.logsVsRdv', { share: pct(logs.equal / logs.sections, 1), equal: int(logs.equal), fewer: int(logs.fewer), more: int(logs.more), sections: int(logs.sections) }) }}
</template>
