<script setup vapor>
import { computed } from 'vue'
import { route, setParam } from '../router'
import { STATE_NAMES } from '../model'
import { blocColor } from '../colors'
import { ensure } from '../data'
import { useAsync } from '../use'
import { objects } from '../db'
import { int, pct } from '../format'
import Panel from '../components/Panel.vue'
import Hemicycle from '../components/Hemicycle.vue'
import DataTable from '../components/DataTable.vue'

// Seats come from the official TSE files (seats_2026 / elected_2026), never from a recomputed formula.
const CHAMBERS = {
  senate: { office: 5, title: 'Senado: 54 cadeiras em disputa', note: 'Em 2026 renovam-se 2 das 3 vagas de cada UF: o gráfico mostra as 54 vagas eleitas; as 27 cadeiras dos senadores eleitos em 2022 não estão nos dados.' },
  chamber: { office: 6, title: 'Câmara dos Deputados: 513 cadeiras', note: 'Cadeiras por partido ou federação, como o TSE as atribui (os partidos de uma federação aparecem juntos).' },
  state: { office: 7, title: 'Assembleia Legislativa', note: 'Cadeiras de deputado estadual por partido ou federação.' },
  district: { office: 8, title: 'Câmara Legislativa do Distrito Federal: 24 cadeiras', note: 'Deputados distritais do DF.' },
}
const chamber = computed(() => (route.value.params.get('chamber') in CHAMBERS ? route.value.params.get('chamber') : 'chamber'))
const uf = computed(() => route.value.params.get('uf') ?? 'sp')
const cfg = computed(() => CHAMBERS[chamber.value])
const scoped = computed(() => chamber.value === 'state') // one state assembly at a time
const ufs = Object.entries(STATE_NAMES).filter(([s]) => s !== 'zz' && s !== 'df')

const seats = useAsync(() => [chamber.value, uf.value], async ([c, u], q) => {
  await ensure('seats_2026')
  const rows = objects(await q(`select bloc, sum(seats)::int seats from seats_2026 where office = $1 and ($2::text = '' or uf = $2) group by 1 order by 2 desc, 1`, [CHAMBERS[c].office, c === 'state' ? u : '']))
  const total = rows.reduce((t, r) => t + r.seats, 0)
  return { total, groups: rows.map((r) => ({ key: r.bloc, label: r.bloc, seats: r.seats, color: blocColor(r.bloc) })) }
})

const elected = useAsync(() => [chamber.value, uf.value], async ([c, u], q) => {
  if (c !== 'senate') return null
  await ensure('elected_2026')
  return objects(await q(`select uf, name, party, votes from elected_2026 where office = 5 order by uf, votes desc`))
})
const cols = [
  { key: 'uf', label: 'UF', fmt: (v) => v.toUpperCase() },
  { key: 'name', label: 'Senador eleito' },
  { key: 'party', label: 'Partido' },
  { key: 'votes', label: 'Votos', num: true, fmt: int },
]
const title = computed(() => (chamber.value === 'state' ? `Assembleia Legislativa · ${STATE_NAMES[uf.value]}` : cfg.value.title))
</script>

<template lang="pug">
h1 Parlamento · 2026
.controls
  label
    | Casa
    select(@change="setParam('chamber', $event.target.value)")
      option(value="senate" :selected="chamber === 'senate'") Senado
      option(value="chamber" :selected="chamber === 'chamber'") Câmara dos Deputados
      option(value="state" :selected="chamber === 'state'") Assembleia Legislativa (UF)
      option(value="district" :selected="chamber === 'district'") Câmara Legislativa do DF
  label(v-if="scoped")
    | UF
    select(@change="setParam('uf', $event.target.value)")
      option(v-for="[s, name] in ufs" :key="s" :value="s" :selected="s === uf") {{ s.toUpperCase() }} · {{ name }}
.grid
  Panel(:title="title" :state="seats" election="2026" wide)
    Hemicycle(:groups="seats.data.groups" :label="`${title}: ${seats.data.total} cadeiras por partido`")
    p.muted {{ cfg.note }}
    p.muted Fonte: TSE (arquivos oficiais de resultado por UF; cadeiras = vagas atribuídas a cada partido/federação). Cores fixas por partido: PT vermelho, PL violeta.
  Panel(v-if="chamber === 'senate'" title="Senadores eleitos" :state="elected" election="2026" wide)
    DataTable(:columns="cols" :rows="elected.data")
</template>
