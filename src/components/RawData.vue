<script setup vapor>
import { computed, ref } from 'vue'
import { ELECTIONS } from '../model'
import { ensure, ensureSmall, store } from '../data'
import { useAsync } from '../use'
import { objects } from '../db'
import { bytes } from '../format'
import { t } from '../i18n'
import { assetUrl, branchUrl, commandOf, fileUrl, findAssets, releaseUrl, sectionId, tseAuxUrl } from '../raw'
import Button from './Button.vue'
import Panel from './Panel.vue'

// Links to the raw files behind the numbers. level 'section': a box with the zips that hold the section's files (release assets), the
// command that extracts them and the live TSE address; the other levels (city, zone, election) only a light line with the release and the code.
const props = defineProps({ election: String, level: { type: String, default: 'election' }, uf: String, city: String, zone: String, section: String })
const el = computed(() => ELECTIONS[props.election])
const raws = new Map()
const loadRaw = (key) => raws.get(key) ?? raws.set(key, fetch(`${import.meta.env.BASE_URL}data/${store.manifest.raw[key].url}`).then((r) => r.json())).get(key)

// the section's TSE city code, and whether it is one of the sections without published files
const section = useAsync(() => [props.election, props.level, props.uf, props.city, props.zone, props.section], async ([key, level, uf, city, zone, sec], q) => {
  if (level !== 'section') return null
  await Promise.all([ensure('mun_map'), el.value.hasCoverage && ensureSmall(key, 'miss')])
  const [m] = objects(await q('select tse from mun_map where state = $1 and city = $2', [uf, city]))
  const [lost] = el.value.hasCoverage ? objects(await q(`select count(*)::int n from miss where election = ${el.value.year} and turn = ${el.value.turn} and state = $1 and city = $2 and zone = $3 and section = $4`, [uf, city, zone, sec])) : [{ n: 0 }]
  const raw = el.value.raw.tag ? await loadRaw(key) : null
  const id = sectionId(uf, m.tse, zone, sec)
  return { raw, id, lost: lost.n > 0, assets: raw && findAssets(raw, id), tseAux: tseAuxUrl(el.value, { uf, city: m.tse, zone, section: sec }) }
})

const rows = computed(() => Object.values(section.data.assets).filter(Boolean).map((a) => ({ ...a, url: assetUrl(section.data.raw, a), command: commandOf(a, section.data.id) })))
const copied = ref(null)
async function copy(row) {
  await navigator.clipboard.writeText(row.command)
  copied.value = row.kind
  setTimeout(() => (copied.value = null), 1500)
}
// release page, the collector's code, the coverage lists (election line only) and the branch
const links = computed(() => [
  ...(el.value.raw.tag ? [{ label: t('raw.release', { tag: el.value.raw.tag }), url: releaseUrl({ tag: el.value.raw.tag }) }] : []),
  ...el.value.raw.code.map((path) => ({ label: path, url: fileUrl(el.value, path) })),
  ...(props.level === 'election' ? (el.value.raw.coverage ?? []).map((path) => ({ label: path, url: fileUrl(el.value, path) })) : []),
  { label: t('raw.collector', { branch: el.value.raw.branch }), url: branchUrl(el.value) },
])
</script>

<template lang="pug">
Panel(v-if="level === 'section'" :title="t('raw.title')" :state="section" :election="election")
  p.muted(v-if="section.data.lost") {{ t('raw.none') }}
  p.muted(v-else-if="!section.data.raw") {{ t('raw.noPerSection') }}
  template(v-else)
    ul.rawfiles
      li(v-for="row in rows" :key="row.kind")
        b {{ t(`raw.kind.${row.kind}`) }}
        a(:href="row.url") {{ row.name }}
        span.muted {{ bytes(row.bytes) }}
        code {{ row.command }}
        Button(variant="ghost" :label="t('raw.copyLabel', { file: row.name })" @click="copy(row)") {{ copied === row.kind ? t('raw.copied') : t('raw.copy') }}
    p.muted {{ t('raw.zipNote') }}
    p.muted(v-if="section.data.tseAux")
      a(:href="section.data.tseAux") {{ t('raw.tseAux') }}
    p.muted(v-else-if="el.raw.tag") {{ t('raw.tseGone') }}
  p.muted
    template(v-for="(l, i) in links" :key="l.url")
      template(v-if="i") {{ ' · ' }}
      a(:href="l.url") {{ l.label }}
p.muted(v-else)
  | {{ t('raw.line') }}&nbsp;
  template(v-for="(l, i) in links" :key="l.url")
    template(v-if="i") {{ ' · ' }}
    a(:href="l.url") {{ l.label }}
</template>
