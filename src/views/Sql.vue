<script setup vapor>
import { computed, ref } from 'vue'
import { route, href, setParam } from '../router'
import { ELECTIONS } from '../model'
import { electionLabel } from '../labels'
import { t } from '../i18n'
import { ensure, ensureDefault, ensureSmall } from '../data'
import { consoleQuery } from '../db'
import { EXAMPLES, TABLES, draft, examplesFor, fill, initialSql } from '../sqlExamples'
import { cell, ms } from '../format'
import Panel from '../components/Panel.vue'
import Field from '../components/Field.vue'
import Button from '../components/Button.vue'
import Notice from '../components/Notice.vue'
import DataTable from '../components/DataTable.vue'

const year = computed(() => route.value.election)
const cfg = computed(() => ELECTIONS[year.value])
const examples = computed(() => examplesFor(year.value))

// Parts are loaded automatically for the tables a statement mentions (directly or through the views): the small tables of every
// election, the default parts of rdv/vt for the elections the statement names (`election = 2022`), else the active one.
const SMALL = ['tot', 'res', 'cov', 'miss', 'residual', 'residual_skipped', 'vtc', 'elected', 'seats']
const SECTION = ['rdv', 'vt']
const VIEW_TABLES = { sec: ['rdv'], cs: ['rdv'], resx: ['res', 'residual'], totx: ['tot', 'residual'] }
async function load(text) {
  const mentioned = [...text.matchAll(/\b[a-z_]+\b/g)].map((m) => m[0])
  const wanted = new Set(mentioned.flatMap((n) => VIEW_TABLES[n] ?? [n]))
  const turns = [...text.matchAll(/turn\s*=\s*(\d)/g)].map((m) => +m[1]) // `election = 2022 and turn = 2` names one round, `election = 2022` both
  const named = Object.values(ELECTIONS).filter((e) => [...text.matchAll(/election\s*=\s*(\d{4})/g)].some((m) => +m[1] === e.year) && (!turns.length || turns.includes(e.turn))).map((e) => e.key)
  await Promise.all([...wanted].flatMap((t) => (SMALL.includes(t) ? Object.keys(ELECTIONS).map((k) => ensureSmall(k, t))
    : SECTION.includes(t) ? (named.length ? named : [year.value]).map((k) => ensureDefault(t, k)) : ['cands', 'mun_map'].includes(t) ? [ensure(t)] : [])))
}

const sql = ref(initialSql(year.value, route.value.params.get('q')))
const out = ref(null)
const failure = ref(null)
const running = ref(false)
const copied = ref(false)

// statements written against the old per-year tables get a friendly pointer to the shared schema
const OLD_TABLE = /relation "(\w*_20\d\d)" does not exist/
const message = computed(() => {
  const old = failure.value.message.match(OLD_TABLE)?.[1]
  if (old) return t('errors.tableGone', { table: old, tables: TABLES.join(', '), year: cfg.value.year, turn: cfg.value.turn })
  return /read-only transaction/.test(failure.value.message) ? t('errors.readOnly') : failure.value.message
})

async function run() {
  running.value = true
  failure.value = null
  try {
    await load(sql.value)
    out.value = await consoleQuery(sql.value)
  } catch (e) {
    failure.value = e
    out.value = null
  } finally {
    running.value = false
  }
}
const edit = (e) => { sql.value = e.target.value; draft.value = { text: sql.value } }
const shareUrl = computed(() => `${location.origin}${href(year.value, 'sql', [], { q: sql.value })}`)
async function share() {
  setParam('q', sql.value)
  await navigator.clipboard.writeText(shareUrl.value)
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}
const shown = computed(() => out.value.rows.slice(0, 500).map((r) => Object.fromEntries(out.value.columns.map((c, i) => [c, r[i]]))))
const columns = computed(() => out.value.columns.map((c) => ({ key: c, label: c, num: typeof out.value.rows[0]?.[out.value.columns.indexOf(c)] === 'number', fmt: (v) => (v == null ? '–' : typeof v === 'number' ? cell(v) : v) })))
const pick = (e) => {
  const example = EXAMPLES.find((x) => x.id === e.target.value)
  draft.value = { example: example.id }
  sql.value = fill(example.sql, year.value)
  e.target.value = ''
}
const loadedElections = computed(() => Object.keys(ELECTIONS).map(electionLabel).join(', '))
const resultInfo = computed(() => [t('sql.rows', { count: out.value.rows.length }) + (out.value.rows.length > 500 ? ` ${t('sql.showing', { n: 500 })}` : ''), ms(out.value.ms)].join(' · '))
if (route.value.params.get('q')) run()
</script>

<template lang="pug">
h1 {{ t('sql.title') }}
.cluster
  Field(:label="t('sql.examplesLabel')")
    select(@change="pick")
      option(value="") {{ t('sql.choose') }}
      option(v-for="e in examples" :key="e.id" :value="e.id") {{ t(`sql.examples.${e.id}`) }}
  Button(:disabled="running" @click="run") {{ t('sql.run') }}
  Button(variant="ghost" @click="share") {{ copied ? t('sql.copied') : t('sql.share') }}
p.muted {{ t('sql.intro', { tables: TABLES.join(', '), elections: loadedElections, active: electionLabel(year) }) }}
textarea.control(:value="sql" spellcheck="false" @input="edit" @keydown.ctrl.enter="run" @keydown.meta.enter="run")
Notice(v-if="failure" kind="danger")
  strong {{ message }}
  pre(v-if="failure.detail") {{ failure.detail }}
details
  summary {{ t('sql.tablesTitle') }}
  ul
    li(v-for="name in TABLES" :key="name")
      code {{ name }}
      |  · {{ t(`sql.tables.${name}`) }}
Panel(v-if="out" :title="t('sql.result')")
  p.muted {{ resultInfo }}
  DataTable(:columns="columns" :rows="shown")
</template>
