<script setup vapor>
import { computed } from 'vue'
import { route, href, setParam } from '../router'
import { ELECTIONS, candVotes, inElection } from '../model'
import { electionLabel, stateTitle } from '../labels'
import { t } from '../i18n'
import { ensure, ensureScope, loadedParts, loadedStates, statesIn } from '../data'
import { useAsync } from '../use'
import { objects } from '../db'
import { int, num, pct } from '../format'
import Panel from '../components/Panel.vue'
import Field from '../components/Field.vue'
import SourceBadge from '../components/SourceBadge.vue'
import BarList from '../components/BarList.vue'
import ColumnChart from '../components/ColumnChart.vue'
import DataTable from '../components/DataTable.vue'
import Notice from '../components/Notice.vue'
import Scatter from '../components/Scatter.vue'

const BINS = 40
const SAMPLE = 4000
const year = computed(() => route.value.election)
const cfg = computed(() => ELECTIONS[year.value])
const state = computed(() => route.value.params.get('state') || null)
const loaded = computed(() => loadedParts('rdv', year.value).length)

// every panel waits for the data of the scope (selected UF, or the default set) and re-runs when more parts arrive
const base = useAsync(() => [year.value, state.value], async ([y, s]) => { await ensure('cands'); await ensureScope('rdv', y, s); return true })
const candidates = useAsync(() => [year.value, state.value, base.loading, loaded.value], async ([y, s], q) => {
  if (base.loading) return null
  return objects(await q(`select cs.cand, coalesce(c.short_name, cs.cand) name, sum(cs.votes) votes from cs cs
    join cands c on c.election = ${cfg.value.year} and c.turn = ${cfg.value.turn} and c.office = 1 and c.n = cs.cand and c.uf = 'br'
    where cs.office = 1 and ${inElection(y, 'cs')} and ($1::text is null or cs.state = $1) group by cs.cand, c.short_name order by votes desc limit 8`, [s]))
})
const cand = computed(() => route.value.params.get('cand') ?? candidates.data?.[0]?.cand ?? null)
const run = (fn) => useAsync(() => [year.value, state.value, cand.value, base.loading, loaded.value], async (d, q) => (base.loading || !cand.value ? null : fn(d, q)))
const rows = async (q, sql, params) => objects(await q(sql, params))

const hist = run(async ([y, s, c], q) => {
  const found = await rows(q, `with v as (${candVotes(y)}) select width_bucket(votes::float8 / nominal, 0, 1.0000001, ${BINS}) b, count(*) n
    from v where nominal > 0 and ($2::text is null or state = $2) group by 1 order by 1`, [c, s])
  const counts = Array(BINS).fill(0)
  found.forEach((r) => (counts[r.b - 1] = r.n))
  return counts
})

const outliers = run(([y, s, c], q) => rows(q, `with v as (${candVotes(y)}),
  sh as (select state, city, zone, section, nominal, votes::float8 / nominal share from v where nominal >= 30 and ($2::text is null or state = $2)),
  z as (select *, (share - avg(share) over w) / nullif(stddev_samp(share) over w, 0) z, count(*) over w n from sh window w as (partition by state, city))
  select state, city, zone, section, nominal, share, z from z where n >= 8 and z is not null order by abs(z) desc limit 20`, [c, s]))

const scatter = run(async ([y, s, c], q) => (await q(`with v as (${candVotes(y)}) select nominal, votes::float8 / nominal from v
  where nominal > 0 and ($2::text is null or state = $2) order by random() limit ${SAMPLE}`, [c, s])).rows)

const cities = run(([y, s, c], q) => rows(q, `with v as (${candVotes(y)}) select state, city, sum(votes) votes, sum(nominal) nominal, count(*) sections,
  sum(votes)::float8 / sum(nominal) share from v where ($2::text is null or state = $2) group by state, city
  having count(*) >= 10 and sum(nominal) > 0 order by share desc limit 15`, [c, s]))

const rates = useAsync(() => [year.value, state.value, base.loading, loaded.value], async ([y, s], q) => {
  if (base.loading) return null
  if (!cfg.value.hasBlank) return []
  return rows(q, `select state, count(*) sections, sum(blank)::float8 / nullif(sum(nominal + blank + nul), 0) blank_rate,
    sum(nul)::float8 / nullif(sum(nominal + blank + nul), 0) null_rate from sec where office = 1 and ${inElection(y)} and ($1::text is null or state = $1) group by state order by state`, [s])
})

const pick = (key, e) => setParam(key, e.target.value)
const stateOptions = computed(() => statesIn('rdv', year.value))
const section = (r) => href(year.value, 'drill', [r.state, r.city, r.zone, r.section])
const histLabels = computed(() => Array.from({ length: BINS }, (_, i) => pct(i / BINS, 1)))
const cols = computed(() => [
  { key: 'state', label: t('common.state'), fmt: (v) => v.toUpperCase() },
  { key: 'city', label: t('common.city') },
  { key: 'zone', label: t('common.zone') },
  { key: 'section', label: t('common.section'), href: section },
  { key: 'nominal', label: t('common.nominalVotes'), num: true, fmt: int },
  { key: 'share', label: t('analysis.candidateShare'), num: true, fmt: (v) => pct(v) },
  { key: 'z', label: t('analysis.zscore'), num: true, fmt: (v) => num(v) },
])
const cityItems = computed(() => cities.data.map((r) => ({ label: `${r.city} (${r.state.toUpperCase()})`, value: r.share, text: t('analysis.citySections', { share: pct(r.share), count: r.sections }), href: href(year.value, 'drill', [r.state, r.city]) })))
const rateLabels = computed(() => rates.data.map((r) => r.state.toUpperCase()))
</script>

<template lang="pug">
h1 {{ t('analysis.title', { election: electionLabel(year) }) }}
SourceBadge(:election="year")
.cluster
  Field(:label="t('analysis.scope')")
    select(:value="state ?? ''" @change="pick('state', $event)")
      option(value="") {{ t('analysis.loaded', { count: loadedStates('rdv', year) }) }}
      option(v-for="s in stateOptions" :key="s" :value="s" :selected="s === state") {{ stateTitle(s) }}
  Field(v-if="candidates.data" :label="t('analysis.candidate')")
    select(:value="cand" @change="pick('cand', $event)")
      option(v-for="c in candidates.data" :key="c.cand" :value="c.cand" :selected="c.cand === cand") {{ c.name }} ({{ c.cand }})
.grid-auto
  Panel(:title="t('analysis.histTitle')" :state="hist" :election="year" wide)
    ColumnChart(:label="t('analysis.histTitle')" :values="hist.data" :labels="histLabels" :tick="int" :fmt="(v) => t('common.sections', { count: v })")
    p.muted {{ t('analysis.histNote', { step: num(100 / BINS, 1) }) }}
  Panel(:title="t('analysis.outliersTitle')" :state="outliers" :election="year" wide)
    p.muted {{ t('analysis.outliersNote') }}
    DataTable(:columns="cols" :rows="outliers.data")
  Panel(:title="t('analysis.scatterTitle')" :state="scatter" :election="year")
    Scatter(:points="scatter.data" :x-label="t('analysis.scatterX')" :y-label="t('analysis.candidateShare')")
    p.muted {{ t('analysis.sample', { n: int(SAMPLE) }) }}
  Panel(:title="t('analysis.citiesTitle')" :state="cities" :election="year")
    BarList(:items="cityItems")
  Panel(:title="t('analysis.benfordTitle')" :election="year")
    Notice(kind="info") {{ t('benford.teaser.body') }}
    a(:href="href(year, 'benford', [], { cand })") {{ t('benford.teaser.link') }}
  Panel(:title="t('analysis.ratesTitle')" :state="rates" :election="year" wide)
    template(v-if="!cfg.hasBlank")
      p.muted {{ t('analysis.noBlank') }}
    template(v-else-if="rates.data")
      ColumnChart(:label="`${t('analysis.ratesTitle')}: ${t('analysis.blanks')}`" :values="rates.data.map((r) => r.blank_rate)" :labels="rateLabels" :fmt="(v) => pct(v, 1)")
      p.muted {{ t('analysis.blanks') }}
      ColumnChart(:label="`${t('analysis.ratesTitle')}: ${t('analysis.nulls')}`" :values="rates.data.map((r) => r.null_rate)" :labels="rateLabels" :fmt="(v) => pct(v, 1)")
      p.muted {{ t('analysis.nulls') }}
</template>
