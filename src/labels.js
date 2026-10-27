// Display names that depend on the language: elections, offices, states and views.
import { electionRegistry } from './election-registry'
import { ELECTIONS, UFS } from './model'
import { t } from './i18n'

export const electionDateLabel = (election) => election.dateMeaning === 'source-context-reported' && election.date ? t('electionData.registrationDate',{date:election.date}) : election.date
export const electionLabel = (key) => ELECTIONS[key].legacyKey ? t('election.name', ELECTIONS[key]) : [ELECTIONS[key].year, ELECTIONS[key].description, electionDateLabel(ELECTIONS[key])].filter(Boolean).join(' · ')
export const officeName = (id) => t(`offices.${id}`)
/** Button group items of the offices of an election (only the ids it has). */
export const officeItems = (ids) => ids.map((id) => ({ value: id, label: officeName(id) }))
export const stateName = (uf) => {
  if (uf === 'br') return t('common.brazil')
  if (UFS.includes(uf)) return t(`states.${uf}`)
  const territory = electionRegistry.historicalStates[uf]
  return territory && !territory.unresolved ? territory.name : t('electionData.originalCode',{code:uf.toUpperCase()})
}
/** "SP · São Paulo" */
export const stateTitle = (uf) => `${uf.toUpperCase()} · ${stateName(uf)}`
export const viewName = (view) => t(`nav.${view}`)
/** The UFs of a select (all but abroad, and optionally without the DF) as [sigla, title]. */
export const stateOptions = (without = []) => UFS.filter((s) => s !== 'zz' && !without.includes(s)).map((s) => [s, stateTitle(s)])

export const grainLabel = (grain) => String(grain ?? '').split(',').filter(Boolean).map((g) => t(`electionAnalysis.grains.${g}`)).join(', ')
