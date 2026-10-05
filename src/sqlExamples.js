// SQL console content. Every election lives in the same tables, so the examples are written once and filter by `election` and `turn`:
// `{year}` and `{turn}` are replaced with the active election's values (see fill()). Titles are sql.examples.<id> in the locale files.
import { ref } from 'vue'
import { ELECTIONS } from './elections.js'

const E = 'election = {year} and turn = {turn}'
export const EXAMPLES = [
  { id: 'uf', sql: `select state, cand, sum(votes) votes from res\nwhere ${E} and office = 1 and state <> 'zz' group by state, cand order by state, votes desc` },
  { id: 'ranking', sql: `with c as (select state, city, cand, sum(votes) votes from res where ${E} and office = 1 group by 1, 2, 3),\n  t as (select state, city, sum(votes) total from c group by 1, 2)\nselect c.state, c.city, c.cand, c.votes, round(c.votes::numeric / t.total * 100, 1) pct\nfrom c join t using (state, city) where t.total > 5000 order by pct desc limit 20` },
  { id: 'outliers', sql: `select state, city, zone, section, nominal,\n  round((nominal - avg(nominal) over w) / nullif(stddev_samp(nominal) over w, 0), 2) z\nfrom sec where ${E} and office = 1 and state = 'ac'\nwindow w as (partition by city) order by abs((nominal - avg(nominal) over w) / nullif(stddev_samp(nominal) over w, 0)) desc nulls last limit 20` },
  { id: 'names', sql: `select r.cand, c.short_name, c.party, sum(r.votes) votes from res r\nleft join cands c on c.election = r.election and c.turn = r.turn and c.office = r.office and c.n = r.cand and c.uf = 'br'\nwhere r.${E.replaceAll(' and ', ' and r.')} and r.office = 1 group by 1, 2, 3 order by 4 desc` },
  { id: 'time', needs: 'hasTimes', sql: `select ord - 1 bucket, sum(v) votes from vtc, unnest(b) with ordinality t(v, ord)\nwhere ${E} group by 1 order by 1` },
  { id: 'cross', sql: `with w as (select election, turn, state, cand, sum(votes) votes from res where office = 1 and state <> 'zz' group by 1, 2, 3, 4),\n  t as (select election, turn, state, sum(votes) total, max(votes) top from w group by 1, 2, 3)\nselect t.state, string_agg(t.election || '/' || t.turn || ': ' || w.cand || ' ' || round(t.top::numeric / t.total * 100, 1) || '%', '   |   ' order by t.election, t.turn) winners\nfrom t join w on w.election = t.election and w.turn = t.turn and w.state = t.state and w.votes = t.top group by t.state order by t.state` },
  { id: 'parts', sql: `select tbl, count(*) parts, sum(rows) rows from _parts group by tbl order by 1` },
  { id: 'catalog', sql: `select table_name, string_agg(column_name, ', ' order by ordinal_position) columns\nfrom information_schema.columns where table_schema = 'public' and table_name not like '\\_%' group by 1 order by 1` },
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

/** Tables and views of the shared schema, listed under the editor (descriptions: sql.tables.<name>). */
export const TABLES = ['rdv', 'sec', 'cs', 'tot', 'res', 'resx', 'totx', 'vt', 'vtc', 'cov', 'miss', 'residual', 'elected', 'seats', 'lineup', 'annulled', 'cands', 'mun_map']
