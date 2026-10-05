// The dynamic families of text keys of the Benford view: one plain string per member, so every key can be found with grep and checked
// by `npm run lint:i18n` (no template-literal keys). The texts are in the locale files under `benford.*`.

export const UNIT = {
  section: { label: 'benford.units.section.label', hint: 'benford.units.section.hint' },
  city: { label: 'benford.units.city.label', hint: 'benford.units.city.hint' },
  uf: { label: 'benford.units.uf.label', hint: 'benford.units.uf.hint' },
}
export const POSITION = {
  d1: 'benford.positions.d1.label', d2: 'benford.positions.d2.label', d12: 'benford.positions.d12.label', d_last: 'benford.positions.d_last.label',
}
export const PSEUDO = { nominal: 'benford.cand.nominal', branco: 'benford.cand.branco', nulo: 'benford.cand.nulo' }
export const GROUP = { candidates: 'benford.cand.group.candidates', parties: 'benford.cand.group.parties', totals: 'benford.cand.group.totals' }

/** Where a digit or a scope stands against the simulated envelope. */
export const FLAG = { above: 'benford.flags.above', below: 'benford.flags.below', inside: 'benford.flags.inside', none: 'benford.flags.none' }
export const MAD_CLASS = {
  close: 'benford.stats.classes.close', acceptable: 'benford.stats.classes.acceptable', marginal: 'benford.stats.classes.marginal', nonconformity: 'benford.stats.classes.nonconformity',
}
export const VERDICT = {
  small: 'benford.verdict.small', nobase: 'benford.verdict.nobase', inside: 'benford.verdict.inside', above: 'benford.verdict.above', below: 'benford.verdict.below',
}
export const HEAT = {
  z: { label: 'benford.heatmap.z', hint: 'benford.heatmap.zHint' },
  rel: { label: 'benford.heatmap.rel', hint: 'benford.heatmap.relHint' },
  adj: { label: 'benford.heatmap.adj', hint: 'benford.heatmap.adjHint' },
}
export const GRAIN = { uf: 'benford.map.grain.uf', mun: 'benford.map.grain.mun' }
export const METRIC = { excess: 'benford.map.metrics.excess', index: 'benford.map.metrics.index', mad: 'benford.map.metrics.mad' }
