// The five macro-regions of Brazil (IBGE) as lists of UFs, in the order of their electorate; their names are regions.<id> in the locale files.
export const REGIONS = {
  sudeste: ['es', 'mg', 'rj', 'sp'],
  nordeste: ['al', 'ba', 'ce', 'ma', 'pb', 'pe', 'pi', 'rn', 'se'],
  sul: ['pr', 'rs', 'sc'],
  norte: ['ac', 'am', 'ap', 'pa', 'ro', 'rr', 'to'],
  'centro-oeste': ['df', 'go', 'ms', 'mt'],
}
export const REGION_IDS = Object.keys(REGIONS)

export const regionOf = (uf) => REGION_IDS.find((id) => REGIONS[id].includes(uf))

const sum = (rows) => rows.reduce((total, r) => total + r.votes, 0)

/** Votes and shares of every candidate (or party) in each region, from rows of { state, key, name, party, votes }: { id: { total, rows } }, rows by votes. */
export function regionTotals(rows) {
  return Object.fromEntries(REGION_IDS.map((id) => {
    const mine = rows.filter((r) => REGIONS[id].includes(r.state))
    const total = sum(mine)
    const list = [...Map.groupBy(mine, (r) => r.key)].map(([key, l]) => ({ key, name: l[0].name, party: l[0].party, votes: sum(l), share: sum(l) / total }))
    return [id, { total, rows: list.sort((a, b) => b.votes - a.votes) }]
  }))
}
