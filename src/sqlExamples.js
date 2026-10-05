// SQL console content. Every election lives in the same tables, so the examples are written once and filter by `election` and `turn`:
// `{year}` and `{turn}` are replaced with the active election's values (see fill()). Texts go through t() once the locale files exist.
import { ref } from 'vue'
import { ELECTIONS } from './elections.js'

const E = 'election = {year} and turn = {turn}'
export const EXAMPLES = [
  { id: 'uf', title: 'Candidato mais votado por UF', sql: `select state, cand, sum(votes) votes from res\nwhere ${E} and office = 1 and state <> 'zz' group by state, cand order by state, votes desc` },
  { id: 'ranking', title: 'Ranking de municípios por votos do primeiro colocado', sql: `with c as (select state, city, cand, sum(votes) votes from res where ${E} and office = 1 group by 1, 2, 3),\n  t as (select state, city, sum(votes) total from c group by 1, 2)\nselect c.state, c.city, c.cand, c.votes, round(c.votes::numeric / t.total * 100, 1) pct\nfrom c join t using (state, city) where t.total > 5000 order by pct desc limit 20` },
  { id: 'outliers', title: 'Seções com tamanho atípico no município (z-score, AC)', sql: `select state, city, zone, section, nominal,\n  round((nominal - avg(nominal) over w) / nullif(stddev_samp(nominal) over w, 0), 2) z\nfrom sec where ${E} and office = 1 and state = 'ac'\nwindow w as (partition by city) order by abs((nominal - avg(nominal) over w) / nullif(stddev_samp(nominal) over w, 0)) desc nulls last limit 20` },
  { id: 'names', title: 'Votos por candidato (presidente), com nomes', sql: `select r.cand, c.short_name, c.party, sum(r.votes) votes from res r\nleft join cands c on c.election = r.election and c.office = r.office and c.n = r.cand and c.uf = 'br'\nwhere r.${E.replaceAll(' and ', ' and r.')} and r.office = 1 group by 1, 2, 3 order by 4 desc` },
  { id: 'time', title: 'Votos por 10 minutos (relógio local)', needs: 'hasTimes', sql: `select ord - 1 bucket, sum(v) votes from vtc, unnest(b) with ordinality t(v, ord)\nwhere ${E} group by 1 order by 1` },
  { id: 'cross', title: 'Presidente: vencedor e % por UF em cada eleição carregada', sql: `with w as (select election, turn, state, cand, sum(votes) votes from res where office = 1 and state <> 'zz' group by 1, 2, 3, 4),\n  t as (select election, turn, state, sum(votes) total, max(votes) top from w group by 1, 2, 3)\nselect t.state, string_agg(t.election || '/' || t.turn || ': ' || w.cand || ' ' || round(t.top::numeric / t.total * 100, 1) || '%', '   |   ' order by t.election, t.turn) winners\nfrom t join w on w.election = t.election and w.turn = t.turn and w.state = t.state and w.votes = t.top group by t.state order by t.state` },
  { id: 'parts', title: 'Partes carregadas no navegador', sql: `select tbl, count(*) parts, sum(rows) rows from _parts group by tbl order by 1` },
  { id: 'catalog', title: 'Catálogo: tabelas, colunas e eleições', sql: `select table_name, string_agg(column_name, ', ' order by ordinal_position) columns\nfrom information_schema.columns where table_schema = 'public' and table_name not like '\\_%' group by 1 order by 1` },
]

/** The examples that make sense for an election (some need voting times or seats). */
export const examplesFor = (key) => EXAMPLES.filter((e) => !e.needs || ELECTIONS[key][e.needs])

export const fill = (sql, key) => sql.replaceAll('{year}', ELECTIONS[key].year).replaceAll('{turn}', ELECTIONS[key].turn)

/** What the user did last in the console, kept across election switches: { text } once edited, { example } id when one was picked. */
export const draft = ref(null)

/** The statement of a fresh console: the first example of the election, unless a draft exists. */
export function initialSql(key, q) {
  if (q) return q
  const examples = examplesFor(key)
  if (draft.value?.text != null) return draft.value.text
  return fill((examples.find((e) => e.id === draft.value?.example) ?? examples[0]).sql, key)
}

/** Tables of the shared schema with their purpose, listed under the editor. */
export const TABLES = [
  ['rdv', 'resultados por seção e cargo (votes = jsonb {número: votos})'], ['sec', 'view de rdv sem o jsonb'], ['cs', 'view: uma linha por seção, cargo e candidato'],
  ['tot', 'totais por município e cargo'], ['res', 'votos por candidato (município; deputados por UF)'], ['resx', 'view: res + votos de seções sem arquivo'], ['totx', 'view: tot + votos de seções sem arquivo'],
  ['vt', 'horários de votação por seção'], ['vtc', 'horários por município'], ['cov', 'cobertura por UF'], ['miss', 'seções sem arquivos'],
  ['residual', 'votos de seções sem arquivo (total oficial)'], ['elected', 'eleitos'], ['seats', 'cadeiras por partido/federação'], ['cands', 'candidatos (election, uf, office, n)'], ['mun_map', 'município → código IBGE'],
]
