<script setup vapor>
import { computed, reactive, ref, watch } from 'vue'
import { route, href, go } from '../router'
import { ELECTIONS, UFS, fold, inElection } from '../model'
import { stateName } from '../labels'
import { ensureScope } from '../data'
import { many } from '../db'
import { parseLookup } from '../lookup'
import { t } from '../i18n'
import Button from './Button.vue'
import Field from './Field.vue'

// A lookup box for every view: "SP zona 127 seção 680" or a municipality's name jumps to that section or municipality in the view being
// read (Drill down, Voting time, Signals, Logs; anywhere else the logs). Several matches are listed instead of guessed.
const TARGETS = ['drill', 'time', 'signals', 'logs']
const year = computed(() => route.value.election)
const target = computed(() => (TARGETS.includes(route.value.view) ? route.value.view : 'logs'))
const text = ref('')
const found = reactive({ busy: false, message: null, rows: [] })
const sectionGrain = (want) => want.zone || want.section
watch(() => route.value.args, () => Object.assign(found, { message: null, rows: [] })) // the list belongs to the page it was asked on

// the section-level tables are per UF: vt (voting times) where the election has logs, else the results
const table = (y) => (ELECTIONS[y].hasTimes ? 'vt' : 'rdv')
const where = (y) => `${inElection(y)} and state = $1 and ($2::text = '' or ${fold('city')} like '%' || ${fold('$2::text')} || '%') and ($3::text = '' or zone = $3) and ($4::text = '' or section = $4)`
const rowsOf = (y, uf, want) => {
  const columns = sectionGrain(want) ? 'city, zone, section' : 'city' // i18n-ignore
  return many(`select distinct ${columns} from ${table(y)} where ${where(y)} order by ${columns} limit 30`, [uf, want.city, want.zone, want.section])
}
const argsOf = (uf, r) => [uf, r.city, ...(r.zone ? [r.zone, r.section] : [])]
const linkOf = (uf, r) => href(year.value, target.value, argsOf(uf, r))
const labelOf = (r) => (r.zone ? t('lookup.match', { city: r.city, zone: r.zone, section: r.section }) : r.city)

async function search() {
  const want = parseLookup(text.value)
  const uf = want.uf || (UFS.includes(route.value.args[0]) ? route.value.args[0] : '')
  Object.assign(found, { message: null, rows: [] })
  if (!want.city && !sectionGrain(want)) return Object.assign(found, { message: t('lookup.empty') })
  if (!uf) return Object.assign(found, { message: t('lookup.needState') })
  found.busy = true
  try {
    await ensureScope(table(year.value), year.value, uf)
    const rows = await rowsOf(year.value, uf, want)
    if (rows.length === 1) return go(linkOf(uf, rows[0]))
    Object.assign(found, rows.length ? { rows: rows.map((r) => ({ href: linkOf(uf, r), label: labelOf(r) })), message: t('lookup.several', { state: stateName(uf) }) } : { message: t('lookup.notFound', { state: stateName(uf) }) })
  } finally {
    found.busy = false
  }
}
</script>

<template lang="pug">
form.cluster(role="search" @submit.prevent="search")
  Field(:label="t('lookup.label')")
    input(type="search" name="q" size="36" :value="text" :placeholder="t('lookup.placeholder')" @input="text = $event.target.value")
  Button(:disabled="found.busy" @click="search") {{ t('lookup.go') }}
p.muted(v-if="found.message" role="status") {{ found.message }}
ul(v-if="found.rows.length")
  li(v-for="r in found.rows" :key="r.href")
    a(:href="r.href") {{ r.label }}
</template>
