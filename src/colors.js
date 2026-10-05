// Party identity: a small data table from party to a design token (never colour values). PT and PL have their own candidate
// tokens; everything else takes a categorical token, with labels, tooltips and tables backing it (too many parties for colour alone).
// The assignment spreads the blocs with the most seats (chamber, senate, assemblies) as far apart as the 19 categorical hues allow.
// Every function returns a CSS value (`var(--...)`) so the browser resolves theme, dark mode and forced colours.
const TOKEN = {
  PT: 'candidate-pt', PL: 'candidate-pl',
  MDB: 'cat-16', PSD: 'cat-1', PP: 'cat-4', UNIÃO: 'cat-6', REPUBLICANOS: 'cat-9', PSB: 'cat-13', PDT: 'cat-7', PSDB: 'cat-5', PODE: 'cat-10',
  PSOL: 'cat-15', NOVO: 'cat-12', PCDOB: 'cat-8', PV: 'cat-14', REDE: 'cat-n1', CIDADANIA: 'cat-11', SOLIDARIEDADE: 'cat-n2',
  AVANTE: 'cat-n3', PRD: 'cat-3', MISSÃO: 'cat-2', DEMOCRATA: 'cat-n3',
}
const PRIORITY = Object.keys(TOKEN)

export const partyColor = (sigla) => `var(--${TOKEN[sigla] ?? 'candidate-other'})`

/** A bloc is a party or a federation written as "PT / PCDOB / PV": it takes the colour of its highest-priority member. */
export const blocColor = (bloc) => {
  const members = bloc.split(' / ')
  return partyColor(PRIORITY.find((p) => members.includes(p)) ?? members[0])
}
