<script setup vapor>
import { ref } from 'vue'
import { href } from '../router'
import Breadcrumb from '../components/Breadcrumb.vue'
import BarList from '../components/BarList.vue'
import Button from '../components/Button.vue'
import Chip from '../components/Chip.vue'
import ColumnChart from '../components/ColumnChart.vue'
import DataTable from '../components/DataTable.vue'
import Field from '../components/Field.vue'
import Hemicycle from '../components/Hemicycle.vue'
import Legend from '../components/Legend.vue'
import Logo from '../components/Logo.vue'
import Notice from '../components/Notice.vue'
import Panel from '../components/Panel.vue'
import Polarization from '../components/Polarization.vue'
import Skeleton from '../components/Skeleton.vue'
import Stat from '../components/Stat.vue'
import Switch from '../components/Switch.vue'
import Tabs from '../components/Tabs.vue'
import Tooltip from '../components/Tooltip.vue'

// Living documentation of src/design: every token group and every component in its states. Only token NAMES live here.
const theme = ref(document.documentElement.dataset.theme ?? 'system')
const setTheme = (e) => {
  theme.value = e.target.value
  if (theme.value === 'system') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = theme.value
}
const BASE = import.meta.env.BASE_URL
const scale = (name, steps) => steps.map((s) => `--color-${name}-${s}`)
const PRIMITIVE_COLORS = [
  ['slate', scale('slate', [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950])],
  ['blue', scale('blue', [100, 300, 400, 500, 600, 700, 800])],
  ['amber', scale('amber', [300, 400, 600, 700])],
  ['red / violet', ['--color-red-100', '--color-red-300', '--color-red-400', '--color-red-500', '--color-red-700', '--color-violet-100', '--color-violet-400', '--color-violet-500']],
  ['status hues', ['--color-green-400', '--color-green-700', '--color-orange-400', '--color-orange-700']],
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
const TYPE = [['--font-size-900', 'Display 900'], ['--font-size-800', 'Título 800'], ['--font-size-700', 'Título 700'], ['--font-size-600', 'Subtítulo 600'], ['--font-size-500', 'Texto 500'], ['--font-size-400', 'Base 400'], ['--font-size-300', 'Tabela 300'], ['--font-size-200', 'Legenda 200'], ['--font-size-100', 'Nota 100']]
const WEIGHTS = ['--font-weight-regular', '--font-weight-medium', '--font-weight-semibold', '--font-weight-bold']
const SPACES = ['--space-1', '--space-2', '--space-3', '--space-4', '--space-5', '--space-6', '--space-8', '--space-10', '--space-12']
const RADII = ['--radius-1', '--radius-2', '--radius-3', '--radius-4', '--radius-full']
const SHADOWS = ['--shadow-1', '--shadow-2', '--shadow-3']
const WINNER_STEPS = [0.4, 0.55, 0.7, 0.85, 1]

const tabs = [{ href: href('2026', 'design'), label: 'Atual', current: true }, { href: href('2026', 'design'), label: 'Outra' }]
const crumbs = [{ label: 'Brasil', href: href('2026', 'drill') }, { label: 'SP · São Paulo' }]
const legendItems = [{ color: 'var(--candidate-pt)', label: 'PT' }, { color: 'var(--candidate-pl)', label: 'PL' }, { color: 'var(--cat-3)', label: 'PP' }]
const bars = [{ label: 'Candidato A', value: 60, text: '60%' }, { label: 'Candidato B', value: 40, text: '40%' }]
const tableCols = [{ key: 'name', label: 'Nome' }, { key: 'votes', label: 'Votos', num: true }]
const tableRows = [{ name: 'Linha', votes: 1234 }, { name: 'Linha com nota', votes: 99, residual: true }]
const seats = [{ key: 'a', label: 'PL', seats: 20, color: 'var(--candidate-pl)' }, { key: 'b', label: 'PT', seats: 12, color: 'var(--candidate-pt)' }, { key: 'c', label: 'PP', seats: 8, color: 'var(--cat-3)' }]
const polar = [{ election: 'Exemplo', a: { name: 'Candidato A', party: 'PL', share: 0.5 }, b: { name: 'Candidato B', party: 'PT', share: 0.3 } }]
const tipText = 'Título do tooltip\nLinha de detalhe'
const columns = [3, 5, 8, 6, 9, 4, 7, 2]
const columnLabels = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
</script>

<template lang="pug">
h1 Sistema de design
p.muted Primitivos (valores crus) → semânticos (significado, claro/escuro) → componentes. Veja src/design/README.md. Esta página documenta cada token e componente no tema ativo.
.cluster
  Field(label="Tema")
    select(:value="theme" @change="setTheme")
      option(value="system") sistema
      option(value="light") claro
      option(value="dark") escuro

.stack
  Panel(title="Marca")
    .cluster
      .swatch-scope(data-theme="light")
        Logo
      .swatch-scope(data-theme="dark")
        Logo
      .swatch-scope(data-theme="light")
        Logo(mark)
      .swatch-scope(data-theme="dark")
        Logo(mark)
    p.muted Espaço livre em volta: pelo menos a altura das barras (cerca de um quinto do símbolo). Tamanho mínimo: símbolo 16 px, logo completo 120 px de largura (abaixo disso, só o símbolo). Não recolorir, esticar, girar nem usar sombras; nunca com as cores de partido (PT, PL).
    .cluster
      a(:href="`${BASE}logo.svg`") logo.svg
      a(:href="`${BASE}logo-mark.svg`") logo-mark.svg
      a(:href="`${BASE}logo-mono.svg`") logo-mono.svg
      a(:href="`${BASE}favicon.svg`") favicon.svg
      a(:href="`${BASE}og-image.png`") og-image.png
    Legend(:items="[{ color: 'var(--brand-blue)', label: '--brand-blue' }, { color: 'var(--brand-amber)', label: '--brand-amber' }, { color: 'var(--brand-wordmark)', label: '--brand-wordmark' }]")

  Panel(title="Primitivos: cores")
    .group(v-for="[name, tokens] in PRIMITIVE_COLORS" :key="name")
      h3.group__title {{ name }}
      .swatches
        figure.swatch(v-for="t in tokens" :key="t")
          i.swatch__chip(:style="{ background: `var(${t})` }")
          figcaption {{ t.replace('--color-', '') }}
  Panel(title="Semânticos: cores no tema ativo")
    .group(v-for="[name, tokens] in SEMANTIC" :key="name")
      h3.group__title {{ name }}
      .swatches
        figure.swatch(v-for="t in tokens" :key="t")
          i.swatch__chip(:style="{ background: `var(${t})` }")
          figcaption {{ t }}
  Panel(title="Tipografia")
    p(v-for="[t, label] in TYPE" :key="t" :style="{ fontSize: `var(${t})` }") {{ label }} · {{ t }}
    p.cluster
      span(v-for="w in WEIGHTS" :key="w" :style="{ fontWeight: `var(${w})` }") {{ w.replace('--font-weight-', '') }}
      code --font-family-mono
  Panel(title="Espaçamento, raios, bordas, sombras, movimento")
    .specimen(v-for="s in SPACES" :key="s")
      code {{ s }}
      i.specimen__space(:style="{ width: `var(${s})` }")
    .cluster
      .specimen__box(v-for="r in RADII" :key="r" :style="{ borderRadius: `var(${r})` }") {{ r.replace('--radius-', 'raio ') }}
      .specimen__box(v-for="s in SHADOWS" :key="s" :style="{ boxShadow: `var(${s})` }") {{ s.replace('--shadow-', 'sombra ') }}
      .specimen__box.specimen__box--border borda 1
      .specimen__box.specimen__box--border-thick borda 2
      .specimen__box.specimen__box--motion passe o mouse (movimento)

  Panel(title="Componentes: ações e campos")
    .cluster
      Button Primário
      Button(variant="ghost") Fantasma
      Button(disabled) Desabilitado
      Field(label="Select")
        select
          option Opção A
          option Opção B
      Field(label="Input")
        input(value="texto")
      Switch(label="Interruptor ligado" :checked="true")
      Switch(label="Interruptor desligado" :checked="false")
    .cluster
      Tabs(:items="tabs" label="Exemplo de abas")
      Breadcrumb(:items="crumbs")
      Chip(href="#") SP
      Chip(href="#") RJ
  Panel(title="Componentes: avisos, estatísticas, carregamento")
    Notice Nota neutra
    Notice(kind="info") Informação
    Notice(kind="warning") Aviso
    Notice(kind="danger") Erro
    Notice(kind="success") Sucesso
    .cluster
      Stat(value="99,66%" label="das seções")
      Stat(value="497.529" label="seções no dump")
    Skeleton
  Panel(title="Componentes: dados")
    Legend(:items="legendItems")
    BarList(:items="bars")
    DataTable(:columns="tableCols" :rows="tableRows")
    .geomap
      Tooltip(:text="tipText" :x="8" :y="8" :show="true")
      .specimen__tooltip-space
    ColumnChart(:values="columns" :labels="columnLabels" :tick="String")
  Panel(title="Componentes: mapa, hemiciclo, polarização")
    .swatches
      figure.swatch(v-for="t in WINNER_STEPS" :key="t")
        i.swatch__chip.swatch__chip--map(:style="{ '--c': 'var(--candidate-pl)', '--t': t }")
        figcaption cor do vencedor, t = {{ t }}
    Hemicycle(:groups="seats" label="Exemplo de hemiciclo")
    Polarization(:rows="polar")
</template>
