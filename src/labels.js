// Display names that depend on the language: elections, offices, states and views.
import { ELECTIONS, UFS } from './model'
import { t } from './i18n'

export const electionLabel = (key) => t('election.name', ELECTIONS[key])
export const officeName = (id) => t(`offices.${id}`)
export const stateName = (uf) => t(`states.${uf}`)
/** "SP · São Paulo" */
export const stateTitle = (uf) => `${uf.toUpperCase()} · ${stateName(uf)}`
export const viewName = (view) => t(`nav.${view}`)
/** The UFs of a select (all but abroad, and optionally without the DF) as [sigla, title]. */
export const stateOptions = (without = []) => UFS.filter((s) => s !== 'zz' && !without.includes(s)).map((s) => [s, stateTitle(s)])
