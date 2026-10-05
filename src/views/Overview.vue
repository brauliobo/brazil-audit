<script setup vapor>
import { computed } from 'vue'
import { route, href, go, setParam } from '../router'
import { ELECTIONS, candJoin, inElection } from '../model'
import { electionLabel, officeName, stateTitle } from '../labels'
import { t } from '../i18n'
import { ensureSmall } from '../data'
import { useAsync } from '../use'
import { objects } from '../db'
import { int, pct, signed, signedPct } from '../format'
import Panel from '../components/Panel.vue'
import Field from '../components/Field.vue'
import Notice from '../components/Notice.vue'
import BarList from '../components/BarList.vue'
import Coverage from '../components/Coverage.vue'
import DataTable from '../components/DataTable.vue'
import ResidualSwitch from '../components/ResidualSwitch.vue'
import Polarization from '../components/Polarization.vue'
import WinnerMap from '../components/WinnerMap.vue'
import { loadGeo } from '../geo'
import { ensureRollups, residualOn, rollup, stateWinners, unitSql, unitsOf } from '../results'

const year = computed(() => route.value.election)
const cfg = computed(() => ELECTIONS[year.value])
const office = computed(() => Number(route.value.params.get('office') ?? 1))
// totals come from the small rollups (tot/res/residual), loaded whole for the election
const base = useAsync(() => [year.value], async ([y]) => { await ensureRollups(y); return true })

// difference between our totals and the official candidate totals, the sections without published files (coverage) and, when
// the residual is on, the official municipality totals added for them and the cities whose official file could not be used
async function officialGap(rows, q, y) {
  const official = rows.reduce((t, r) => t + (r.official ?? 0), 0)
  if (!official) return null
  const ours = rows.filter((r) => r.official).reduce((t, r) => t + r.votes, 0)
  await ensureSmall(y, 'cov', 'residual', 'residual_skipped')
  const [c] = objects(await q(`select sum(missing) missing from cov where ${inElection(y)}`))
  const [r] = objects(await q(`select coalesce(sum(votes) filter (where number not in ('branco', 'nulo')), 0) votes,
    (select coalesce(sum(m), 0) from (select max(sections_missing) m from residual where office = 1 and ${inElection(y)} group by uf, city, zone) t) sections from residual where office = 1 and ${inElection(y)}`))
  const skipped = objects(await q(`select uf, city, reason from residual_skipped where office = 1 and ${inElection(y)} order by uf, city`))
  return { votes: ours - official, share: (ours - official) / official, missing: c.missing, residual: residualOn.value ? r : null, skipped }
}

// the two leaders of each election's presidential race, from the official totals (independent of the dump's coverage)
const polarization = useAsync(() => [base.loading], async (_, q) => {
  if (base.loading) return null
  const rows = objects(await q(`select election, short_name name, party, official_votes::float8 / sum(official_votes) over (partition by election) share from cands
    where office = 1 and uf = 'br' and official_votes is not null order by election desc, official_votes desc`))
  return Object.entries(Object.groupBy(rows, (r) => r.election)).sort(([a], [b]) => b - a).map(([e, l]) => ({ election: e, a: l[0], b: l[1] }))
})
const ufmap = useAsync(() => [year.value, base.loading, residualOn.value], async ([y], q) => {
  if (base.loading) return null
  const [rows, map, winners] = await Promise.all([q(unitSql(y, 'uf'), [1, '']), loadGeo('uf'), stateWinners(q, y)])
  return { units: unitsOf(rows), map, abroad: winners.find((r) => r.state === 'zz' && r.rn === 1) }
})

const PARTY = `left join (select substr(n,1,2) num, max(party) party from cands where election=$2 and office>1 group by 1) p on p.num = substr(r.cand,1,2)`
const results = useAsync(() => [year.value, office.value, base.loading, residualOn.value], async ([y, o], q) => {
  if (base.loading) return null
  const { res, tot } = rollup(y)
  const sql = o === 1
    ? `select coalesce(c.n, '-') cand, max(c.short_name) name, max(c.party) party, sum(r.votes) votes, max(c.official_votes) official, sum(sum(r.votes)) over () total
       from ${res} r ${candJoin(y, 'r')} where r.office = $1 and ${inElection(y, 'r')} group by 1 order by votes desc limit 20`
    : `select substr(r.cand,1,2) cand, max(p.party) name, max(p.party) party, sum(r.votes) votes, null official, sum(sum(r.votes)) over () total
       from ${res} r ${PARTY} where r.office = $1 and ${inElection(y, 'r')} group by 1 order by votes desc limit 20`
  const rows = objects(await q(sql, o === 1 ? [o] : [o, cfg.value.year]))
  const gap = o === 1 ? await officialGap(rows, q, y) : null
  const [t] = objects(await q(`select sum(sections) sections, sum(nominal) nominal, sum(blank) blank, sum(nul) nul from ${tot} where office = $1 and ${inElection(y)}`, [o]))
  return { rows, gap, ...t }
})

const states = useAsync(() => [year.value, office.value, base.loading, residualOn.value], async ([y, o], q) => {
  if (base.loading) return null
  return objects(await q(`select state, sum(sections) sections, sum(nominal) nominal, sum(blank) blank, sum(nul) nul from ${rollup(y).tot} where office = $1 and ${inElection(y)} group by state order by state`, [o]))
})

const items = computed(() => results.data.rows.map((r) => ({
  label: `${r.name ?? t('common.others')} ${r.party && r.party !== r.name ? `(${r.party})` : ''} ${r.cand === '-' ? '' : `· ${r.cand}`}`,
  value: r.votes,
  text: `${int(r.votes)} · ${pct(r.votes / r.total)}${r.official ? ` · ${t('overview.official', { n: int(r.official) })}` : ''}`,
})))
const gapText = (gap) => t(gap.residual ? (gap.skipped.length ? 'overview.gapLeftSkipped' : 'overview.gapLeft') : 'overview.gap',
  { votes: signed(gap.votes), share: signedPct(gap.share), skipped: gap.skipped.length, missing: int(gap.missing) })
const totals = computed(() => {
  const r = results.data
  return [t('common.sections', { count: r.sections }), t('common.nominal', { n: int(r.nominal) }), ...(r.blank == null ? [] : [t('common.blank', { n: int(r.blank) }), t('common.nul', { n: int(r.nul) })])].join(' · ')
})
const rate = (v, r) => (v == null ? '–' : pct(v / (r.nominal + r.blank + r.nul)))
const cols = computed(() => [
  { key: 'state', label: t('common.state'), href: (r) => href(year.value, 'drill', [r.state], { office: office.value }), fmt: stateTitle },
  { key: 'sections', label: t('common.sections'), num: true, fmt: int },
  { key: 'nominal', label: t('common.nominalVotes'), num: true, fmt: int },
  { key: 'blank', label: t('common.blanks'), num: true, fmt: rate },
  { key: 'nul', label: t('common.nulls'), num: true, fmt: rate },
])
</script>

<template lang="pug">
h1 {{ electionLabel(year) }}
.cluster(v-if="cfg.hasResidual")
  ResidualSwitch
.grid-auto
  #cobertura.span-all
    Coverage(:year="year")
  Panel(:title="t('overview.national')" :state="results" :election="year" wide)
    Field(v-if="cfg.offices.length > 1" :label="t('common.office')")
      select(:value="office" @change="setParam('office', $event.target.value)")
        option(v-for="id in cfg.offices" :key="id" :value="id" :selected="id === office") {{ officeName(id) }}
    p.muted(v-if="office !== 1") {{ t('overview.partyAggregate') }}
    BarList(:items="items")
    template(v-if="results.data.gap")
      Notice(v-if="results.data.gap.residual")
        | {{ t('overview.included', { votes: int(results.data.gap.residual.votes), sections: int(results.data.gap.residual.sections) }) }}&nbsp;
        a(href="#cobertura") {{ t('overview.seeCoverage') }}
      Notice(v-if="results.data.gap.votes" kind="warning") {{ gapText(results.data.gap) }}
    p.muted {{ totals }}
    p.muted(v-if="results.data.rows.some((r) => r.cand === '-')") {{ t('overview.unlisted', { label: t('common.others') }) }}
  Panel(:title="t('overview.polarization')" :state="polarization" :election="year")
    Polarization(:rows="polarization.data")
    p.muted {{ t('overview.polarizationNote') }}
  Panel(:title="t('overview.winnerByState')" :state="ufmap" :election="year")
    WinnerMap(:units="ufmap.data.units" :map="ufmap.data.map" grain="uf" :abroad="ufmap.data.abroad" :label="t('overview.winnerMapLabel')" @pick="go(href(year, 'maps', [], { scope: 'state', uf: $event }))")
    p.muted
      | {{ t('overview.winnerNote') }}&nbsp;
      a(:href="href(year, 'maps')") {{ t('overview.seeMaps') }}
  Panel(:title="t('overview.byState')" :state="states" :election="year" wide)
    DataTable(:columns="cols" :rows="states.data")
</template>
