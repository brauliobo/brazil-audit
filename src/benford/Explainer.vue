<script setup vapor>
import { int, pct } from '../format'
import { t } from '../i18n'
import { minSample } from './stats'

// The plain-language panel: what the law says, why it is a heuristic, why section counts break it, what the baseline adds,
// how to read the numbers, what is included. `build` = the parameters recorded in the manifest by the build.
const props = defineProps({ build: Object })
const SECTIONS = [
  { id: 'law', title: 'benford.explainer.law.title', body: ['benford.explainer.law.p1'] },
  { id: 'heuristic', title: 'benford.explainer.heuristic.title', body: ['benford.explainer.heuristic.p1'] },
  { id: 'sections', title: 'benford.explainer.sections.title', body: ['benford.explainer.sections.p1'] },
  { id: 'second', title: 'benford.explainer.second.title', body: ['benford.explainer.second.p1', 'benford.explainer.second.p2'] },
  { id: 'flag', title: 'benford.explainer.flag.title', body: ['benford.explainer.flag.p1', 'benford.explainer.flag.p2'] },
  { id: 'read', title: 'benford.explainer.read.title', body: ['benford.explainer.read.p1', 'benford.explainer.read.p2', 'benford.explainer.read.p3'] },
]
const INCLUDED = [
  'benford.explainer.included.sections', 'benford.explainer.included.president', 'benford.explainer.included.local',
  'benford.explainer.included.deputies', 'benford.explainer.included.totals', 'benford.explainer.included.digits',
]
const SOURCES = [
  ['benford.explainer.sources.deckert', 'https://econpapers.repec.org/RePEc:cup:polals:v:19:y:2011:i:03:p:245-268_01'],
  ['benford.explainer.sources.mebane', 'https://public.websites.umich.edu/~wmebane/pm06.pdf'],
  ['benford.explainer.sources.nigrini', "https://www.wiley.com/en-us/Benford's+Law:+Applications+for+Forensic+Accounting,+Auditing,+and+Fraud+Detection-p-9781118152850"],
]
const vars = {
  minD1: int(minSample('d1')), minD2: int(minSample('d2')), minD12: int(minSample('d12')), minLast: int(minSample('d_last')),
  nationalShare: pct(props.build.nationalShare, 0), localShare: pct(props.build.localShare, 0), bigShare: pct(props.build.bigShare, 0),
  munLocalShare: pct(props.build.munLocalShare, 0), munNationalShare: pct(props.build.munNationalShare, 0), munSections: int(props.build.munSections[1]), munSectionsOther: int(props.build.munSections.other),
}
</script>

<template lang="pug">
.bf-explainer
  section(v-for="s in SECTIONS" :key="s.id" :id="`bf-${s.id}`")
    h3 {{ t(s.title) }}
    p(v-for="key in s.body" :key="key") {{ t(key, vars) }}
  section#bf-included
    h3 {{ t('benford.explainer.included.title') }}
    ul
      li(v-for="key in INCLUDED" :key="key") {{ t(key, vars) }}
  section#bf-sources
    h3 {{ t('benford.explainer.sources.title') }}
    ul
      li(v-for="[key, url] in SOURCES" :key="url")
        a(:href="url") {{ t(key) }}
</template>
