// How the calculation reads on screen: names of lists and candidates, how a seat was won, the groups of a hemicycle.
import { computed, ref } from 'vue'
import { t } from '../i18n'
import { titleCase } from '../results'
import { blocColor, partyColor } from '../colors'

/** A federation reads as its parties ("PCDOB / PT / PV"), a coalition as its name; a lone party as itself. */
export const blocLabel = (bloc, unit) => (unit === 'coalition' && bloc.parties.length > 1 ? bloc.name : bloc.bloc)

export const candidateName = (names, uf, n) => (names.get(`${uf}/${n}`)?.name ? titleCase(names.get(`${uf}/${n}`).name) : n)

/** "Quociente partidário", "Sobra 3 (fase 1)" or "Mais votados". */
export const how = (seat) => (seat.kind === 'qp' ? t('seats.how.qp') : seat.kind === 'top' ? t('seats.how.top') : t('seats.how.avg', { round: seat.round, phase: seat.phase + 1 }))

/**
 * The seats of some results as hemicycle groups: one per list (a federation, a coalition by its name); the national chamber merges the
 * results of the UFs, where a coalition differs from UF to UF, so its seats go to the party of each elected candidate.
 */
export function seatGroups(results, { unit, national = false }) {
  const [groups, byParty] = [new Map(), national && unit === 'coalition']
  for (const r of results) {
    for (const b of r.blocs) {
      for (const c of b.elected) {
        const sigla = b.parties.find((p) => p.party === c.n.slice(0, 2))?.sigla
        const [label, color] = byParty ? [sigla, partyColor(sigla)] : [blocLabel(b, unit), blocColor(b.bloc)]
        groups.set(label, { key: label, label, color, seats: (groups.get(label)?.seats ?? 0) + 1 })
      }
    }
  }
  return [...groups.values()].sort((a, b) => b.seats - a.seats || a.label.localeCompare(b.label))
}

/** Rows sorted by a column the user picks (a click on its header flips the direction): { sort, sorted, flip } for DataTable. */
export function useSort(rows, initial) {
  const sort = ref(initial)
  const order = (a, b) => (typeof a === 'string' ? a.localeCompare(b) : (a ?? 0) - (b ?? 0))
  const sorted = computed(() => rows.value.toSorted((a, b) => (sort.value.dir === 'asc' ? 1 : -1) * order(a[sort.value.key], b[sort.value.key])))
  const flip = (key) => (sort.value = { key, dir: sort.value.key === key && sort.value.dir === 'desc' ? 'asc' : 'desc' })
  return { sort, sorted, flip }
}
