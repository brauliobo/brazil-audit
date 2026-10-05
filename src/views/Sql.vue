<script setup vapor>
import { computed, ref } from 'vue'
import { route, href, setParam } from '../router'
import { ELECTIONS } from '../model'
import { ensure, ensureDefault, ensureSmall } from '../data'
import { query } from '../db'
import { EXAMPLES, TABLES, draft, examplesFor, fill, initialSql } from '../sqlExamples'
import { ms, int } from '../format'
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
  const named = Object.values(ELECTIONS).filter((e) => [...text.matchAll(/election\s*=\s*(\d{4})/g)].some((m) => +m[1] === e.year)).map((e) => e.key)
  await Promise.all([...wanted].flatMap((t) => (SMALL.includes(t) ? Object.keys(ELECTIONS).map((k) => ensureSmall(k, t))
    : SECTION.includes(t) ? (named.length ? named : [year.value]).map((k) => ensureDefault(t, k)) : ['cands', 'mun_map'].includes(t) ? [ensure(t)] : [])))
}

const sql = ref(initialSql(year.value, route.value.params.get('q')))
const out = ref(null)
const error = ref(null)
const running = ref(false)
const copied = ref(false)

// statements written against the old per-year tables get a friendly pointer to the shared schema
const OLD_TABLE = /relation "(\w*_20\d\d)" does not exist/
const friendly = (e) => (OLD_TABLE.test(e.message) ? Object.assign(new Error(`A tabela ${e.message.match(OLD_TABLE)[1]} não existe mais: todas as eleições usam as mesmas tabelas (${TABLES.map((t) => t[0]).join(', ')}) com as colunas election e turn. Exemplo: where election = ${cfg.value.year} and turn = ${cfg.value.turn}. Veja o catálogo nos exemplos.`), { detail: e.detail }) : e)

async function run() {
  running.value = true
  error.value = null
  try {
    await load(sql.value)
    out.value = await query(sql.value)
  } catch (e) {
    error.value = friendly(e)
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
const columns = computed(() => out.value.columns.map((c) => ({ key: c, label: c, num: typeof out.value.rows[0]?.[out.value.columns.indexOf(c)] === 'number' })))
const pick = (e) => {
  const example = EXAMPLES.find((x) => x.id === e.target.value)
  draft.value = { example: example.id }
  sql.value = fill(example.sql, year.value)
  e.target.value = ''
}
const loadedElections = computed(() => Object.values(ELECTIONS).map((e) => `${e.year} (turno ${e.turn})`).join(', '))
if (route.value.params.get('q')) run()
</script>

<template lang="pug">
h1 Console SQL
.cluster
  Field(label="Exemplos")
    select(@change="pick")
      option(value="") escolher…
      option(v-for="e in examples" :key="e.id" :value="e.id") {{ e.title }}
  Button(:disabled="running" @click="run") Executar
  Button(variant="ghost" @click="share") {{ copied ? 'link copiado' : 'copiar link' }}
p.muted Todas as eleições usam as mesmas tabelas ({{ TABLES.map((t) => t[0]).join(', ') }}); filtre por <code>election</code> e <code>turn</code>. Eleições: {{ loadedElections }}; a ativa é {{ cfg.year }} (turno {{ cfg.turn }}). Ao citar uma tabela, as UFs menores (e as tabelas pequenas de todas as eleições) são importadas sozinhas; para uma UF específica abra-a antes em Detalhar/Horários.
textarea.control(:value="sql" spellcheck="false" @input="edit" @keydown.ctrl.enter="run" @keydown.meta.enter="run")
Notice(v-if="error" kind="danger")
  strong {{ error.message }}
  pre(v-if="error.detail") {{ error.detail }}
Panel(v-if="out" title="Resultado")
  p.muted {{ int(out.rows.length) }} linhas{{ out.rows.length > 500 ? ' (mostrando 500)' : '' }} · {{ ms(out.ms) }}
  DataTable(:columns="columns" :rows="shown")
</template>
