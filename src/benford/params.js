// URL state of the Benford view: ?office=&cand=&unit=&place=&digits=&minn= (plus metric, grain and sort of the secondary panels).
import { computed } from 'vue'
import { ELECTIONS } from '../elections.js'
import { UFS } from '../model'
import { route } from '../router'
import { POS_OF } from './analysis'
import { minSample } from './stats'

export const UNITS = ['section', 'city', 'uf']
export const DIGIT_KEYS = Object.keys(POS_OF)
export const HEAT = ['z', 'rel', 'adj']
export const GRAINS = ['uf', 'mun']
export const MAP_METRICS = ['excess', 'index', 'mad']

const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback)

/** `br`, `sp` or `sp/CITY` -> { uf, city }; the unit decides what is a valid place (a UF unit only exists nationally, a city unit not per city). */
export function placeOf(raw, unit) {
  const [uf, city = null] = (raw ?? 'br').split('/')
  if (unit === 'uf' || !UFS.includes(uf)) return { uf: 'br', city: null }
  return { uf, city: unit === 'city' ? null : city }
}

export const placeParam = ({ uf, city }) => (city ? `${uf}/${city}` : uf)

export const params = computed(() => {
  const { election, params: q } = route.value
  const offices = ELECTIONS[election].offices
  const unit = pick(q.get('unit'), UNITS, 'section')
  const digits = pick(q.get('digits'), DIGIT_KEYS, '1')
  const pos = POS_OF[digits]
  return {
    election,
    office: pick(+q.get('office'), offices, 1),
    unit,
    digits,
    pos,
    cand: q.get('cand'),
    ...placeOf(q.get('place'), unit),
    minn: Number(q.get('minn')) > 0 ? Number(q.get('minn')) : minSample(pos),
    minnGiven: q.get('minn') != null,
    heat: pick(q.get('heat'), HEAT, 'z'),
    grain: pick(q.get('grain'), GRAINS, 'uf'),
    metric: pick(q.get('metric'), MAP_METRICS, 'excess'),
  }
})
