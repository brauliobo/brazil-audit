// Fixed party colours (colour follows the entity, never its rank). PT red and PL violet are validated for light and dark
// surfaces and colour-vision deficiencies; the others are mid-lightness hues that work on both surfaces and are always
// backed by labels, tooltips and tables (there are too many parties for colour alone to identify them).
import { ref } from 'vue'

const dark = matchMedia('(prefers-color-scheme: dark)')
export const isDark = ref(dark.matches)
dark.addEventListener('change', (e) => (isDark.value = e.matches))

const CORE = { PT: ['#d6252e', '#e8505b'], PL: ['#5b3fd6', '#8c7cf0'] }
const OTHERS = {
  MDB: '#e0a000', PSD: '#12a594', PP: '#2a78d6', UNIÃO: '#29a3d6', REPUBLICANOS: '#2e9b3e', PSB: '#eb6834', PDT: '#c2255c',
  PSDB: '#4c9f70', PODE: '#8bb92e', PSOL: '#d6409f', NOVO: '#f08c00', PCDOB: '#9c4a3a', PV: '#66bb6a', REDE: '#26a69a',
  CIDADANIA: '#e0607e', SOLIDARIEDADE: '#ff7043', AVANTE: '#8e6fd1', PRD: '#8d6e63', MISSÃO: '#c9a400', DEMOCRATA: '#5d7b8a',
  AGIR: '#7a8b3a', PMB: '#9e9e9e', PRTB: '#6d6d6d', DC: '#a1887f', MOBILIZA: '#78909c', PMN: '#90a4ae', PCO: '#b0413e', PSTU: '#a0282d', UP: '#c0392b', PCB: '#8a1c1c',
}
const NEUTRAL = '#8b92a0'
const PRIORITY = ['PT', 'PL', ...Object.keys(OTHERS)]

export const partyColor = (sigla) => (CORE[sigla] ? CORE[sigla][isDark.value ? 1 : 0] : OTHERS[sigla] ?? NEUTRAL)

/** A bloc is a party or a federation written as "PT / PCDOB / PV": it takes the colour of its highest-priority member. */
export const blocColor = (bloc) => {
  const members = bloc.split(' / ')
  return partyColor(PRIORITY.find((p) => members.includes(p)) ?? members[0])
}
