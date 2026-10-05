// Party identity: a small data table from party to a design token (never colour values). PT and PL have their own candidate
// tokens; everything else takes a categorical token, with labels, tooltips and tables backing it (too many parties for colour alone).
// Every function returns a CSS value (`var(--...)`) so the browser resolves theme, dark mode and forced colours.
const TOKEN = {
  PT: 'candidate-pt', PL: 'candidate-pl',
  MDB: 'cat-1', PSD: 'cat-2', PP: 'cat-3', UNIÃO: 'cat-4', REPUBLICANOS: 'cat-5', PSB: 'cat-6', PDT: 'cat-7', PSDB: 'cat-8', PODE: 'cat-9',
  PSOL: 'cat-10', NOVO: 'cat-11', PCDOB: 'cat-12', PV: 'cat-13', REDE: 'cat-14', CIDADANIA: 'cat-15', SOLIDARIEDADE: 'cat-16',
  AVANTE: 'cat-n3', PRD: 'cat-n1', MISSÃO: 'cat-n2', DEMOCRATA: 'cat-n3',
}
const PRIORITY = Object.keys(TOKEN)

export const partyColor = (sigla) => `var(--${TOKEN[sigla] ?? 'candidate-other'})`

/** A bloc is a party or a federation written as "PT / PCDOB / PV": it takes the colour of its highest-priority member. */
export const blocColor = (bloc) => {
  const members = bloc.split(' / ')
  return partyColor(PRIORITY.find((p) => members.includes(p)) ?? members[0])
}
