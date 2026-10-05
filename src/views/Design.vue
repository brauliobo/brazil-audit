<script setup vapor>
import { computed, ref } from 'vue'
import { href } from '../router'
import { t } from '../i18n'
import { stateTitle } from '../labels'
import Breadcrumb from '../components/Breadcrumb.vue'
import BarList from '../components/BarList.vue'
import Button from '../components/Button.vue'
import ButtonGroup from '../components/ButtonGroup.vue'
import Chip from '../components/Chip.vue'
import ColumnChart from '../components/ColumnChart.vue'
import DataTable from '../components/DataTable.vue'
import Field from '../components/Field.vue'
import Hemicycle from '../components/Hemicycle.vue'
import LangSwitch from '../components/LangSwitch.vue'
import Legend from '../components/Legend.vue'
import Logo from '../components/Logo.vue'
import Notice from '../components/Notice.vue'
import Panel from '../components/Panel.vue'
import Polarization from '../components/Polarization.vue'
import Skeleton from '../components/Skeleton.vue'
import Stat from '../components/Stat.vue'
import Switch from '../components/Switch.vue'
import Tabs from '../components/Tabs.vue'
import ThemeSwitch from '../components/ThemeSwitch.vue'
import Tooltip from '../components/Tooltip.vue'

// Living documentation of src/design: every token group and every component in its states. Only token NAMES live here.
const BASE = import.meta.env.BASE_URL
const scale = (name, steps) => steps.map((s) => `--color-${name}-${s}`)
const PRIMITIVE_COLORS = [
  ['slate', scale('slate', [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950])],
  ['blue', scale('blue', [100, 300, 400, 500, 600, 700, 800])],
  ['amber', scale('amber', [300, 400, 600, 700])],
  ['red / violet', ['--color-red-100', '--color-red-300', '--color-red-400', '--color-red-500', '--color-red-700', '--color-violet-100', '--color-violet-400', '--color-violet-500']],
  ['status hues', ['--color-green-400', '--color-green-700', '--color-orange-400', '--color-orange-700']], // i18n-ignore
  ['categorical', [...Array.from({ length: 16 }, (_, i) => `--color-cat-${i + 1}`), '--color-cat-n1', '--color-cat-n2', '--color-cat-n3']],
]
const SEMANTIC = [
  ['surface', ['--surface-page', '--surface-raised', '--surface-sunken', '--surface-overlay', '--surface-inverse']],
  ['text', ['--text-primary', '--text-secondary', '--text-muted', '--text-inverse', '--text-link', '--text-danger', '--text-warning', '--text-success']],
  ['border / accent', ['--border-default', '--border-strong', '--border-focus', '--accent', '--accent-hover', '--accent-subtle']],
  ['status', ['--status-success', '--status-warning', '--status-danger', '--status-info', '--status-success-bg', '--status-warning-bg', '--status-danger-bg', '--status-info-bg']],
  ['candidate / brand', ['--candidate-pt', '--candidate-pl', '--candidate-other', '--brand-blue', '--brand-amber', '--brand-lens', '--brand-wordmark']],
  ['data-viz', ['--chart-bar', '--chart-highlight', '--chart-grid', '--chart-axis-text', '--seq-margin', '--seq-blank', '--map-missing', '--map-blend-base', '--map-stroke', '--map-hover-stroke']],
  ['categorical', [...Array.from({ length: 16 }, (_, i) => `--cat-${i + 1}`), '--cat-n1', '--cat-n2', '--cat-n3']],
]
const TYPE = [['--font-size-900', 'display'], ['--font-size-800', 'title800'], ['--font-size-700', 'title700'], ['--font-size-600', 'subtitle600'], ['--font-size-500', 'text500'], ['--font-size-400', 'base400'], ['--font-size-300', 'table300'], ['--font-size-200', 'caption200'], ['--font-size-100', 'note100']]
const WEIGHTS = ['--font-weight-regular', '--font-weight-medium', '--font-weight-semibold', '--font-weight-bold']
const SPACES = ['--space-1', '--space-2', '--space-3', '--space-4', '--space-5', '--space-6', '--space-8', '--space-10', '--space-12']
const RADII = ['--radius-1', '--radius-2', '--radius-3', '--radius-4', '--radius-full']
const SHADOWS = ['--shadow-1', '--shadow-2', '--shadow-3']
const WINNER_STEPS = [0.4, 0.55, 0.7, 0.85, 1]

const tabs = computed(() => [{ href: href('2026', 'design'), label: t('design.tabCurrent'), current: true }, { href: href('2026', 'design'), label: t('design.tabOther') }])
const crumbs = computed(() => [{ label: t('common.brazil'), href: href('2026', 'drill') }, { label: stateTitle('sp') }])
const legendItems = [{ color: 'var(--candidate-pt)', label: 'PT' }, { color: 'var(--candidate-pl)', label: 'PL' }, { color: 'var(--cat-3)', label: 'PP' }]
const bars = computed(() => [{ label: t('design.candidateA'), value: 60, text: '60%' }, { label: t('design.candidateB'), value: 40, text: '40%' }])
const tableCols = computed(() => [{ key: 'name', label: t('design.name') }, { key: 'votes', label: t('common.votes'), num: true }])
const tableRows = computed(() => [{ name: t('design.row'), votes: 1234 }, { name: t('design.rowNote'), votes: 99, residual: true }])
const seats = [{ key: 'a', label: 'PL', seats: 20, color: 'var(--candidate-pl)' }, { key: 'b', label: 'PT', seats: 12, color: 'var(--candidate-pt)' }, { key: 'c', label: 'PP', seats: 8, color: 'var(--cat-3)' }]
const polar = computed(() => [{ election: '2026', a: { name: t('design.candidateA'), party: 'PL', share: 0.5 }, b: { name: t('design.candidateB'), party: 'PT', share: 0.3 } }])
const choice = ref('a')
const choices = computed(() => ['a', 'b', 'c'].map((value) => ({ value, label: t('design.option', { n: value.toUpperCase() }) })))
const tipText = computed(() => `${t('design.tooltipTitle')}\n${t('design.tooltipDetail')}`)
const columns = [3, 5, 8, 6, 9, 4, 7, 2]
const columnLabels = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
</script>

<template lang="pug">
h1 {{ t('design.title') }}
p.muted {{ t('design.intro') }}
.cluster
  ThemeSwitch
  LangSwitch

.stack
  Panel(:title="t('design.brand')")
    .cluster
      .swatch-scope(data-theme="light")
        Logo
      .swatch-scope(data-theme="dark")
        Logo
      .swatch-scope(data-theme="light")
        Logo(mark)
      .swatch-scope(data-theme="dark")
        Logo(mark)
    p.muted {{ t('design.brandRules') }}
    .cluster
      a(:href="`${BASE}logo.svg`") logo.svg
      a(:href="`${BASE}logo-mark.svg`") logo-mark.svg
      a(:href="`${BASE}logo-mono.svg`") logo-mono.svg
      a(:href="`${BASE}favicon.svg`") favicon.svg
      a(:href="`${BASE}og-image.png`") og-image.png
    Legend(:items="[{ color: 'var(--brand-blue)', label: '--brand-blue' }, { color: 'var(--brand-amber)', label: '--brand-amber' }, { color: 'var(--brand-wordmark)', label: '--brand-wordmark' }]")

  Panel(:title="t('design.primitives')")
    .group(v-for="[name, tokens] in PRIMITIVE_COLORS" :key="name")
      h3.group__title {{ name }}
      .swatches
        figure.swatch(v-for="tk in tokens" :key="tk")
          i.swatch__chip(:style="{ background: `var(${tk})` }")
          figcaption {{ tk.replace('--color-', '') }}
  Panel(:title="t('design.semantic')")
    .group(v-for="[name, tokens] in SEMANTIC" :key="name")
      h3.group__title {{ name }}
      .swatches
        figure.swatch(v-for="tk in tokens" :key="tk")
          i.swatch__chip(:style="{ background: `var(${tk})` }")
          figcaption {{ tk }}
  Panel(:title="t('design.typography')")
    p(v-for="[token, label] in TYPE" :key="token" :style="{ fontSize: `var(${token})` }") {{ t(`design.type.${label}`) }} · {{ token }}
    p.cluster
      span(v-for="w in WEIGHTS" :key="w" :style="{ fontWeight: `var(${w})` }") {{ w.replace('--font-weight-', '') }}
      code --font-family-mono
  Panel(:title="t('design.scales')")
    .specimen(v-for="s in SPACES" :key="s")
      code {{ s }}
      i.specimen__space(:style="{ width: `var(${s})` }")
    .cluster
      .specimen__box(v-for="r in RADII" :key="r" :style="{ borderRadius: `var(${r})` }") {{ t('design.radius', { n: r.replace('--radius-', '') }) }}
      .specimen__box(v-for="s in SHADOWS" :key="s" :style="{ boxShadow: `var(${s})` }") {{ t('design.shadow', { n: s.replace('--shadow-', '') }) }}
      .specimen__box.specimen__box--border {{ t('design.border1') }}
      .specimen__box.specimen__box--border-thick {{ t('design.border2') }}
      .specimen__box.specimen__box--motion {{ t('design.motion') }}

  Panel(:title="t('design.actions')")
    .cluster
      Button {{ t('design.primary') }}
      Button(variant="ghost") {{ t('design.ghost') }}
      Button(disabled) {{ t('design.disabled') }}
      Field(:label="t('design.select')")
        select
          option {{ t('design.option', { n: 'A' }) }}
          option {{ t('design.option', { n: 'B' }) }}
      Field(:label="t('design.input')")
        input(:value="t('design.inputValue')")
      ButtonGroup(:label="t('design.buttonGroup')" :items="choices" :value="choice" @change="choice = $event")
      Switch(:label="t('design.switchOn')" :checked="true")
      Switch(:label="t('design.switchOff')" :checked="false")
    .cluster
      Tabs(:items="tabs" :label="t('design.tabsLabel')")
      Breadcrumb(:items="crumbs")
      Chip(href="#") SP
      Chip(href="#") RJ
  Panel(:title="t('design.feedback')")
    Notice {{ t('design.noteNeutral') }}
    Notice(kind="info") {{ t('design.info') }}
    Notice(kind="warning") {{ t('design.warning') }}
    Notice(kind="danger") {{ t('design.danger') }}
    Notice(kind="success") {{ t('design.success') }}
    .cluster
      Stat(value="99,66%" :label="t('design.statShare')")
      Stat(value="497.529" :label="t('design.statSections')")
    Skeleton
  Panel(:title="t('design.data')")
    Legend(:items="legendItems")
    BarList(:items="bars")
    DataTable(:columns="tableCols" :rows="tableRows")
    .geomap
      Tooltip(:text="tipText" :x="8" :y="8" :show="true")
      .specimen__tooltip-space
    ColumnChart(:label="t('design.data')" :values="columns" :labels="columnLabels" :tick="String")
  Panel(:title="t('design.mapHemicycle')")
    .swatches
      figure.swatch(v-for="step in WINNER_STEPS" :key="step")
        i.swatch__chip.swatch__chip--map(:style="{ '--c': 'var(--candidate-pl)', '--t': step }")
        figcaption {{ t('design.winnerColor', { t: step }) }}
    Hemicycle(:groups="seats" :label="t('design.hemicycleExample')")
    Polarization(:rows="polar")
</template>
