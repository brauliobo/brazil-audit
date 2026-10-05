// The proportional-representation rules, as data: calc.js reads these and never branches on a year. Each election names its rule in
// src/elections.js (`seatRule`); the others are offered as what-if variants. Shares are percentages of the quociente eleitoral (QE).
//   unit        what a list is: 'coalition' (2018) or 'federation' (2022 on); the blocs themselves come from the data (table lineup)
//   candidate   art. 108 of the Código Eleitoral: the votes a candidate needs, to take a seat won by quociente partidário
//   phases      the sobras (art. 109), maior média: each phase runs until no list qualifies, then the next one starts;
//               { party, candidate } = the least votes a list and its next candidate need to take part
//   noQuotient  what happens when no list reaches the QE: 'top' = the most voted candidates are elected (art. 111, struck down by the
//               STF in 2024), 'averages' = all seats go through the sobras phases
//   alternative the rule shown by the what-if switch
//   sources     [{ id, url }] of the texts that define the rule (labels: seats.sources.<id> in the locale files)
const CE = { id: 'ce', url: 'https://www.planalto.gov.br/ccivil_03/leis/l4737compilado.htm' }

export const RULES = {
  coalitions2018: {
    id: 'coalitions2018', unit: 'coalition', candidate: 10, noQuotient: 'top', alternative: 'federations2022',
    phases: [{ party: 0, candidate: 10 }, { party: 0, candidate: 0 }],
    sources: [CE, { id: 'law13488', url: 'https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2017/lei/l13488.htm' }, { id: 'res23554', url: 'https://www.tse.jus.br/legislacao/compilada/res/2017/resolucao-no-23-554-de-18-de-dezembro-de-2017' }],
  },
  federations2022: {
    id: 'federations2022', unit: 'federation', candidate: 10, noQuotient: 'top', alternative: 'stf2024',
    phases: [{ party: 80, candidate: 20 }, { party: 80, candidate: 0 }],
    sources: [CE, { id: 'law14211', url: 'https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2021/lei/L14211.htm' }, { id: 'res23677', url: 'https://www.tse.jus.br/legislacao/compilada/res/2021/resolucao-no-23-677-de-16-de-dezembro-de-2021' }],
  },
  stf2024: {
    id: 'stf2024', unit: 'federation', candidate: 10, noQuotient: 'averages', alternative: 'federations2022',
    phases: [{ party: 80, candidate: 20 }, { party: 0, candidate: 0 }],
    sources: [CE, { id: 'stf2024', url: 'https://portal.stf.jus.br/noticias/verNoticiaDetalhe.asp?idConteudo=528283&ori=1' }, { id: 'stf2025', url: 'https://noticias.stf.jus.br/postsnoticias/decisao-do-stf-sobre-distribuicao-de-sobras-eleitorais-vale-desde-2022/' }, { id: 'res23677', url: 'https://www.tse.jus.br/legislacao/compilada/res/2021/resolucao-no-23-677-de-16-de-dezembro-de-2021' }, { id: 'res23748', url: 'https://www.tse.jus.br/legislacao/compilada/res/2026/resolucao-no-23-748-de-26-de-fevereiro-de-2026' }],
  },
}
