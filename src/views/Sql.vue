<script setup vapor>
import { computed, ref } from 'vue'
import { route, href, setParam } from '../router'
import { ensureDefault } from '../data'
import { query } from '../db'
import { ms, int } from '../format'
import Panel from '../components/Panel.vue'
import Field from '../components/Field.vue'
import Button from '../components/Button.vue'
import Notice from '../components/Notice.vue'
import DataTable from '../components/DataTable.vue'

const year = computed(() => route.value.election)
// parts auto-loaded (the default set) for the tables a statement mentions, directly or through the sec_/cs_ views
const NEEDS = [[/votes_2022|(cs|sec)_2022/, 'votes_2022'], [/rdv_2026|(cs|sec)_2026/, 'rdv_2026'], [/vt_2026/, 'vt_2026'], [/vtc_2026/, 'vtc_2026'], [/tot_2026/, 'tot_2026'], [/res_2026|resx_2026/, 'res_2026'], [/residual_2026|resx_2026|totx_2026/, 'residual_2026'], [/cov_2026/, 'cov_2026'], [/miss_2026/, 'miss_2026'], [/cands/, 'cands']]
const EXAMPLES = computed(() => [
  ['Totais por UF', `select state, sum(votes_13) lula, sum(votes_22) bolsonaro from votes_2022 group by state order by 1`],
  ['Ranking de municípios (2022)', `select state, city, sum(votes_13)::float8 / sum(votes_13 + votes_22) share_13, count(*) sections\nfrom votes_2022 group by state, city having count(*) > 100 order by share_13 desc limit 20`],
  ['Seções com maior margem (z-score na cidade)', `with s as (select state, city, zone, section, votes_13::float8 / nullif(votes_13 + votes_22, 0) share from votes_2022 where state = 'ac')\nselect *, (share - avg(share) over w) / nullif(stddev_samp(share) over w, 0) z from s window w as (partition by state, city) order by abs(z) desc nulls last limit 20`],
  ['Votos por candidato (2026, presidente)', `select r.cand, c.short_name, sum(r.votes) votes from res_2026 r left join cands c on c.election = 2026 and c.office = 1 and c.n = r.cand and c.uf = 'br'\nwhere r.office = 1 group by 1, 2 order by 3 desc`],
  ['Votos por 10 min (2026, relógio local)', `select ord - 1 bucket, sum(v) votes from vtc_2026, unnest(b) with ordinality t(v, ord) group by 1 order by 1`],
  ['Tabelas e partes carregadas', `select tbl, count(*) parts, sum(rows) rows from _parts group by tbl order by 1`],
  ['Catálogo', `select table_name, table_type from information_schema.tables where table_schema = 'public' order by 1`],
])
const sql = ref(route.value.params.get('q') ?? EXAMPLES.value[0][1])
const out = ref(null)
const error = ref(null)
const running = ref(false)
const copied = ref(false)

async function run() {
  running.value = true
  error.value = null
  try {
    await Promise.all(NEEDS.filter(([re]) => re.test(sql.value)).map(([, t]) => ensureDefault(t)))
    out.value = await query(sql.value)
  } catch (e) {
    error.value = e
    out.value = null
  } finally {
    running.value = false
  }
}
const shareUrl = computed(() => `${location.origin}${href(year.value, 'sql', [], { q: sql.value })}`)
async function share() {
  setParam('q', sql.value)
  await navigator.clipboard.writeText(shareUrl.value)
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}
const shown = computed(() => out.value.rows.slice(0, 500).map((r) => Object.fromEntries(out.value.columns.map((c, i) => [c, r[i]]))))
const columns = computed(() => out.value.columns.map((c) => ({ key: c, label: c, num: typeof out.value.rows[0]?.[out.value.columns.indexOf(c)] === 'number' })))
const pick = (e) => { sql.value = EXAMPLES.value[e.target.value][1]; e.target.value = '' }
if (route.value.params.get('q')) run()
</script>

<template lang="pug">
h1 Console SQL
.cluster
  Field(label="Exemplos")
    select(@change="pick")
      option(value="") escolher…
      option(v-for="(e, i) in EXAMPLES" :key="i" :value="i") {{ e[0] }}
  Button(:disabled="running" @click="run") Executar
  Button(variant="ghost" @click="share") {{ copied ? 'link copiado' : 'copiar link' }}
  small.muted Tabelas: votes_2022, rdv_2026, vt_2026, vtc_2026, cands e views sec_/cs_ · cita uma tabela e as UFs menores são importadas sozinhas; para uma UF específica abra-a antes em Detalhar/Horários
textarea.control(v-model="sql" spellcheck="false" @keydown.ctrl.enter="run" @keydown.meta.enter="run")
Notice(v-if="error" kind="danger")
  strong {{ error.message }}
  pre(v-if="error.detail") {{ error.detail }}
Panel(v-if="out" title="Resultado")
  p.muted {{ int(out.rows.length) }} linhas{{ out.rows.length > 500 ? ' (mostrando 500)' : '' }} · {{ ms(out.ms) }}
  DataTable(:columns="columns" :rows="shown")
</template>
