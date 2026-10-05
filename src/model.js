// Election metadata and the SQL views that give every election the same shape:
//   sec_<y>(state,city,zone,section,model,office,nominal,blank,nul)        one row per section and office
//   cs_<y> (state,city,zone,section,model,office,cand,votes,nominal)       one row per section, office and candidate
export const ELECTIONS = {
  2022: { label: '2022 · 2º turno', offices: { 1: 'Presidente' }, time: false },
  2026: {
    label: '2026 · 1º turno',
    offices: { 1: 'Presidente', 3: 'Governador', 5: 'Senador', 6: 'Deputado federal', 7: 'Deputado estadual', 8: 'Deputado distrital' },
    time: true,
  },
}

/** The latest election is the default everywhere. */
export const DEFAULT_ELECTION = Object.keys(ELECTIONS).at(-1)

export const VIEW_LABELS = { overview: 'Visão geral', maps: 'Mapas', parliament: 'Parlamento', drill: 'Detalhar', analysis: 'Análise', time: 'Horários', sql: 'SQL' }

/** Routes outside the main navigation (linked from the footer). */
export const HIDDEN_VIEWS = { design: 'Sistema de design' }

export const STATE_NAMES = {
  ac: 'Acre', al: 'Alagoas', am: 'Amazonas', ap: 'Amapá', ba: 'Bahia', ce: 'Ceará', df: 'Distrito Federal', es: 'Espírito Santo',
  go: 'Goiás', ma: 'Maranhão', mg: 'Minas Gerais', ms: 'Mato Grosso do Sul', mt: 'Mato Grosso', pa: 'Pará', pb: 'Paraíba',
  pe: 'Pernambuco', pi: 'Piauí', pr: 'Paraná', rj: 'Rio de Janeiro', rn: 'Rio Grande do Norte', ro: 'Rondônia', rr: 'Roraima',
  rs: 'Rio Grande do Sul', sc: 'Santa Catarina', se: 'Sergipe', sp: 'São Paulo', to: 'Tocantins', zz: 'Exterior',
}

export const VIEWS = [
  `create or replace view sec_2022 as select state,city,zone,section,model,1 office,votes_13+votes_22 nominal,null::int blank,null::int nul from votes_2022`,
  `create or replace view cs_2022 as
    select state,city,zone,section,model,1 office,'13' cand,votes_13 votes,votes_13+votes_22 nominal from votes_2022
    union all select state,city,zone,section,model,1,'22',votes_22,votes_13+votes_22 from votes_2022`,
  // city and candidate rollups with the shape of the 2026 tot_2026 / res_2026 tables
  `create or replace view tot_2022 as select state,city,1 office,count(*) sections,sum(votes_13+votes_22) nominal,null::bigint blank,null::bigint nul from votes_2022 group by 1,2`,
  `create or replace view res_2022 as select state,city,1 office,'13' cand,sum(votes_13) votes from votes_2022 group by 1,2
    union all select state,city,1,'22',sum(votes_22) from votes_2022 group by 1,2`,
  // rollups plus the official municipality totals of sections without published files (see residual_2026)
  `create or replace view resx_2026 as select state, city, office, cand, votes from res_2026
    union all select uf, city, office, number, votes from residual_2026 where number not in ('branco', 'nulo')`,
  `create or replace view totx_2026 as select state, city, office, sections, nominal, blank, nul from tot_2026
    union all select uf, city, office, 0, sum(votes) filter (where number not in ('branco', 'nulo')), coalesce(sum(votes) filter (where number = 'branco'), 0),
      coalesce(sum(votes) filter (where number = 'nulo'), 0) from residual_2026 group by uf, city, office`,
  `create or replace view sec_2026 as select state,city,zone,section,model,office,nominal,blank,nul from rdv_2026`,
  `create or replace view cs_2026 as
    select r.state,r.city,r.zone,r.section,r.model,r.office,e.key cand,e.value::int votes,r.nominal from rdv_2026 r, jsonb_each_text(r.votes) e`,
]

export const OTHERS = 'Outros / inválidos'

/** Joins a cs_<y> alias to its candidate name: presidential candidates are national, all others per state. */
export const candJoin = (year, alias = 'cs') =>
  `left join cands c on c.election=${year} and c.office=${alias}.office and c.n=${alias}.cand and c.uf=(case when ${alias}.office=1 then 'br' else ${alias}.state end)`

/** Per-section presidential votes of candidate `$1` (zero when absent) with the section's nominal total. */
export const candVotes = (year) => year === '2022'
  ? `select state,city,zone,section,model,nominal,votes from cs_2022 where cand = $1`
  : `select state,city,zone,section,model,nominal,coalesce((votes->>$1)::int, 0) votes from rdv_2026 where office = 1`

/** Time-of-day buckets (vt_2026.b / vtc_2026.b): bucket 0 starts at 05:00 on the recorded local clock, 10 minutes each. */
export const BUCKET = { start: 5 * 3600, step: 600 }

/** PGlite sorts in C.UTF-8 codepoint order (accented letters after Z): this key orders Portuguese names like pt-BR. */
export const collate = (col) => `translate(${col}, 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ', 'AAAAAEEEEIIIIOOOOOUUUUCN')`
