<script setup vapor>
import { computed, markRaw } from 'vue'
import { route, href } from '../router'
import { ELECTIONS, selectedOffice } from '../model'
import { electionLabel, stateTitle } from '../labels'
import { t } from '../i18n'
import { ensure } from '../data'
import { candidatesSql, ensureElection } from '../election-results'
import { useAsync } from '../use'
import { objects } from '../db'
import { int, num, pct, signed } from '../format'
import { BLOCS, blocOfScore, blocsSql, coalitionsSql, crossTab, paradoxOf, paradoxes, topSql, winnersOf } from '../spectrum'
import { roundCandidatesSql, roundGrainOf, roundVotesSql } from '../contest'
import { ensureRound } from '../contest-load'
import Panel from '../components/Panel.vue'
import Notice from '../components/Notice.vue'
import Tabs from '../components/Tabs.vue'
import Stat from '../components/Stat.vue'
import DataTable from '../components/DataTable.vue'
import BarList from '../components/BarList.vue'
import ElectionContext from '../components/ElectionContext.vue'

const TABS = ['blocs', 'coalitions', 'paradox']
const COALITION_OFFICES = [1, 3, 5, 6, 7, 8] // the offices of the TSE coalition files
const TOP = 20

const key = computed(() => route.value.election)
const cfg = computed(() => ELECTIONS[key.value])
const office = computed(() => selectedOffice(key.value, route.value.params.get('office')))
const state = computed(() => route.value.params.get('state') || null)
const tab = computed(() => (TABS.includes(route.value.params.get('tab')) ? route.value.params.get('tab') : 'blocs'))
const national = computed(() => office.value.constituencyGrain === 'national')
const states = computed(() => (national.value ? [] : office.value.capabilities.states.filter((s) => s && s !== 'br')))
const scope = computed(() => ({ state: state.value ?? undefined }))
const tabItems = computed(() => TABS.map((id) => ({ href: href(key.value, 'spectrum', [], { ...Object.fromEntries(route.value.params), tab: id }), label: t(`spectrum.tab.${id}`), current: id === tab.value })))

const bloc = (b) => t(`spectrum.bloc.${b}`)
const base = useAsync(() => [key.value, office.value.key, state.value], async ([k, o, s]) => {
  await Promise.all([ensure('spectrum'), ensureElection(k, o, { state: s ?? undefined, grain: 'state' })])
  return true
})

// ---- Blocos: the votes of each bloc and the most voted candidates ---------------------------------------------------------------------------
const blocs = useAsync(() => [key.value, office.value.key, state.value, base.loading], async ([k, o], q) => {
  if (base.loading) return null
  const [totals, top] = await Promise.all([blocsSql, topSql].map(async (build) => objects(await q(...Object.values(build(candidatesSql(k, o, scope.value), cfg.value.year))))))
  const total = totals.reduce((n, r) => n + Number(r.votes), 0)
  return { total, top: top.map((r) => ({ ...r, votes: Number(r.votes) })), blocs: BLOCS.map((b) => ({ ...totals.find((r) => r.bloc === b) ?? { bloc: b, votes: 0, candidates: 0 } })) }
})
const blocItems = computed(() => (blocs.data?.blocs ?? []).map((b) => ({ label: bloc(b.bloc), value: Number(b.votes), text: `${int(b.votes)} · ${pct(blocs.data.total ? b.votes / blocs.data.total : null, 1)} · ${t('spectrum.blocsLine', { candidates: int(b.candidates) })}` })))
const candidateCols = computed(() => [
  { key: 'name', label: t('spectrum.col.candidate') }, { key: 'party', label: t('spectrum.col.party') }, { key: 'bloc', label: t('spectrum.col.bloc'), fmt: bloc },
  { key: 'votes', label: t('spectrum.col.votes'), num: true, fmt: int }, { key: 'share', label: t('spectrum.col.share'), num: true, fmt: (v) => pct(v, 1) },
])
const candidateRows = computed(() => (blocs.data?.top ?? []).map((r) => ({ ...r, share: blocs.data.total ? r.votes / blocs.data.total : null })))

// ---- Coligações: every coalition of the office and the average position of its parties ----------------------------------------------------
const coalitionOffice = computed(() => (COALITION_OFFICES.includes(Number(office.value.id)) ? Number(office.value.id) : null))
const coalitions = useAsync(() => [key.value, coalitionOffice.value, national.value ? 'br' : state.value, tab.value], async ([, o, uf, tb], q) => {
  if (tb !== 'coalitions' || !o) return null
  await Promise.all([ensure('spectrum'), ensure('coalition')])
  return objects(await q(...Object.values(coalitionsSql(cfg.value.year, cfg.value.turn, o, uf))))
})
const coalitionCols = computed(() => [
  ...(national.value ? [] : [{ key: 'uf', label: t('spectrum.col.uf'), fmt: (v) => v.toUpperCase() }]),
  { key: 'name', label: t('spectrum.col.coalition'), fmt: (v, r) => v || r.members }, { key: 'kind', label: t('spectrum.col.kind'), fmt: (v) => t(`spectrum.kind.${v}`) },
  { key: 'parties', label: t('spectrum.col.parties'), num: true, fmt: int }, { key: 'members', label: t('spectrum.col.members') },
  { key: 'score', label: t('spectrum.col.score'), num: true, fmt: (v) => (v == null ? '–' : `${bloc(blocOfScore(v))} · ${signed(v, 1)}`) },
])

// ---- Votos paradoxais: the winners for president and governor of each municipality, on opposite sides ------------------------------------
const available = computed(() => ['president', 'governor'].every((o) => roundGrainOf(key.value, o)))
const paradox = useAsync(() => [key.value, tab.value], async ([k, tb], q) => {
  if (tb !== 'paradox' || !available.value) return null
  const run = async ({ sql, params }) => objects(await q(sql, params))
  await ensure('spectrum')
  const spectrum = objects(await q('select * from spectrum'))
  const [president, governor] = await Promise.all(['president', 'governor'].map(async (o) => {
    await ensureRound(k, o)
    const [votes, candidates] = await Promise.all([run(roundVotesSql(k, o, roundGrainOf(k, o))), run(roundCandidatesSql(k, o))])
    return winnersOf(votes, candidates, spectrum, cfg.value.year)
  }))
  const rows = paradoxOf(president, governor)
  const names = new Map(objects(await q('select state, city_code city, city_name name from election_places where session_key = $1', [ELECTIONS[k].sourceSession.key])).map((c) => [`${c.state}|${c.city}`, c.name]))
  return markRaw({ total: rows.length, split: paradoxes(rows), cross: crossTab(rows), names })
})
const crossCols = computed(() => [{ key: 'side', label: t('spectrum.col.president'), fmt: (v) => t(`spectrum.side.${v}`) }, ...['left', 'center', 'right', 'none'].map((s, i) => ({ key: `c${i}`, label: t(`spectrum.side.${s}`), num: true }))])
const crossRows = computed(() => (paradox.data?.cross ?? []).map((r) => ({ side: r.side, ...Object.fromEntries(r.cells.map((c, i) => [`c${i}`, int(c.n)])) })))
const paradoxCols = computed(() => [
  { key: 'city', label: t('spectrum.col.city'), fmt: (v, r) => `${paradox.data.names.get(`${r.state}|${v}`) ?? v} · ${stateTitle(r.state)}` },
  { key: 'pname', label: t('spectrum.col.president'), fmt: (v, r) => `${v} · ${bloc(r.pbloc)}` }, { key: 'pvotes', label: t('spectrum.col.president_votes'), num: true, fmt: int },
  { key: 'gname', label: t('spectrum.col.governor'), fmt: (v, r) => `${v} · ${bloc(r.gbloc)}` }, { key: 'gvotes', label: t('spectrum.col.governor_votes'), num: true, fmt: int },
])
</script>

<template lang="pug">
h1 {{ t('spectrum.title', { election: electionLabel(key) }) }}
Notice(kind="warning") {{ t('spectrum.caution') }}
ElectionContext(:states="tab === 'coalitions' ? states : []")
Tabs(:items="tabItems" :label="t('spectrum.tabs')")
Notice(v-if="base.error" kind="danger") {{ base.error.message }}
.grid-auto(v-else)
  template(v-if="tab === 'blocs'")
    Panel(:title="t('spectrum.blocsTitle', { office: office.name })" :state="blocs" :election="key" wide)
      template(v-if="blocs.data?.total")
        p.muted {{ t('spectrum.blocsNote') }}
        BarList(:items="blocItems")
      p.muted(v-else-if="blocs.data") {{ t('spectrum.noVotes') }}
    Panel(v-if="blocs.data?.total" :title="t('spectrum.candidatesTitle')" :state="blocs" :election="key" wide)
      DataTable(:columns="candidateCols" :rows="candidateRows")
  template(v-else-if="tab === 'coalitions'")
    Panel(:title="t('spectrum.coalitionsTitle', { office: office.name })" :state="coalitions" :election="key" wide)
      p.muted {{ t('spectrum.coalitionsNote') }}
      DataTable(v-if="coalitions.data?.length" :columns="coalitionCols" :rows="coalitions.data")
      p.muted(v-else-if="coalitions.data") {{ t('spectrum.noCoalitions') }}
      p.muted(v-else-if="!coalitionOffice") {{ t('spectrum.noCoalitions') }}
  template(v-else)
    Notice(v-if="!available" kind="note") {{ t('spectrum.paradoxUnavailable') }}
    Panel(v-else :title="t('spectrum.paradoxTitle')" :state="paradox" :election="key" wide)
      template(v-if="paradox.data")
        p {{ t('spectrum.paradoxSummary', { n: int(paradox.data.split.length), total: int(paradox.data.total) }) }}
        p.muted {{ t('spectrum.paradoxNote') }}
        h3 {{ t('spectrum.paradoxCross') }}
        DataTable(:columns="crossCols" :rows="crossRows")
        DataTable(:columns="paradoxCols" :rows="paradox.data.split.slice(0, TOP)")
</template>
