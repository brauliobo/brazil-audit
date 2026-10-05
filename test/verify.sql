-- The checks of an import, on the data of the database. From the root of the repository: test/verify <year>
-- Reads the zone totals as a CSV from the standard input (made by test/verify).
\pset pager off
\set ON_ERROR_STOP on

\echo '== files imported: rows read, rows loaded, unclassified, skipped'
select count(*) files, sum(rows) rows_read, sum(loaded) rows_loaded, sum(unclassified) unclassified, sum(skipped) skipped from imports;
select regexp_replace(name, '[_/].*', '') kind, count(*) files, sum(rows) rows_read, sum(skipped) skipped, sum(loaded) rows_loaded
from imports group by 1 order by 1;

\echo '== (a) votacao_secao: rows read (not skipped) = (kind, number) entries aggregated, votes in = votes out, per file'
create temp table rv as
select state, turn, office,
       (select count(*) from jsonb_each(votes) k, jsonb_each(k.value) n) entries,
       (select sum(n.value::bigint) from jsonb_each(votes) k, jsonb_each(k.value) n) votes
from rdv_votes;
with f as (
  select substring(name from 'votacao_secao_[0-9]{4}_([A-Z]{2})\.zip') unit, rows, loaded, votes, unclassified, skipped
  from imports where name like 'votacao_secao_%'
), a as (
  select case when office = 1 then 'BR' else upper(state) end unit, sum(entries) entries, sum(votes) votes, count(*) section_offices
  from rv group by 1
)
select count(*) units, count(*) filter (where f.rows - f.skipped <> a.entries) rows_differ, count(*) filter (where f.votes <> a.votes) votes_differ,
       count(*) filter (where f.unit is null or a.unit is null) unit_in_one_side, sum(f.rows - f.skipped) rows_read, sum(a.entries) entries_aggregated,
       sum(f.votes) votes_in, sum(a.votes) votes_out, sum(f.unclassified) unclassified
from f full join a using (unit);

\echo '== (b) nominal votes by section (kind 2) vs candidate totals by zone (elected), per candidate and turn'
create temp table sec as
select case when r.office = 1 then 'br' else r.state end scope, r.turn, r.office, n.key number, sum(n.value::bigint) votes
from rdv_votes r, jsonb_each(r.votes -> '2') n group by 1, 2, 3, 4;
create temp table cmp as
select e.state, e.turn, e.office, e.number, e.name, e.votes zone_votes, coalesce(s.votes, 0) section_votes
from elected e left join sec s on s.scope = e.state and s.turn = e.turn and s.office = e.office and s.number = e.number;
select office, count(*) candidates, count(*) filter (where zone_votes = section_votes) equal, count(*) filter (where zone_votes <> section_votes) different,
       sum(zone_votes - section_votes) net_diff
from cmp group by 1 order by 1;
select * from cmp where zone_votes <> section_votes order by abs(zone_votes - section_votes) desc limit 10;
\echo '-- numbers with votes by section but no candidate in elected (votes of rejected candidacies), by office, and their status'
create temp table missing as
select s.* from sec s left join elected e on e.state = s.scope and e.turn = s.turn and e.office = s.office and e.number = s.number
where e.sq_candidato is null;
select c.status, count(*) numbers, sum(m.votes) votes, round(100.0 * sum(m.votes) / (select sum(votes) from sec), 2) pct_of_nominal
from missing m left join candidates c on c.state = m.scope and c.turn = m.turn and c.office = m.office and c.number = m.number
group by 1 order by 3 desc;

\echo '== (c) sections per state: rdv_votes, section_detail, section_urn, urn_match (turn 1 and 2)'
select turn, state, r.n rdv_votes, d.n section_detail, u.n section_urn, m.n urn_match
from (select distinct turn from section_detail) t
join lateral (select state, count(distinct (city_code, zone, section)) n from section_detail where turn = t.turn group by 1) d on true
left join lateral (select count(distinct (city_code, zone, section)) n from rdv_votes where turn = t.turn and state = d.state) r on true
left join lateral (select count(distinct (city_code, zone, section)) n from section_urn where turn = t.turn and state = d.state) u on true
left join lateral (select count(*) n from urn_match where turn = t.turn and state = d.state) m on true
where r.n is distinct from d.n or u.n is distinct from d.n or m.n is distinct from d.n
order by 1, 2;
\echo '-- (the rows above are the states where a table has other sections than section_detail)'
select turn, count(distinct state) states, count(distinct city_code) municipalities, count(distinct (city_code, zone)) zones,
       count(distinct (city_code, zone, section)) sections_detail,
       (select count(distinct (city_code, zone, section)) from rdv_votes r where r.turn = d.turn) sections_with_votes
from section_detail d group by 1 order by 1;
select state, count(distinct city_code) municipalities, count(distinct (city_code, zone)) zones, count(distinct (city_code, zone, section)) sections
from section_detail where turn = 1 group by 1 order by 1;

\echo '== (d) votes of the BU files vs rdv_votes per state and turn (all offices)'
create temp table rvt as select state, turn, sum(votes) votes from rv group by 1, 2;
create temp table bu as
select lower(substring(name from '_[12]t_([A-Za-z]{2})_')) state, substring(name from '_([12])t_')::int turn, votes bu_votes
from imports where name ilike 'bweb_%';
select count(*) state_turns, count(*) filter (where rvt.votes = bu.bu_votes) equal, count(*) filter (where rvt.votes is distinct from bu.bu_votes) different
from rvt full join bu using (state, turn);
select state, turn, rvt.votes rdv_votes, bu_votes, bu_votes - rvt.votes diff from rvt full join bu using (state, turn)
where rvt.votes is distinct from bu.bu_votes order by 1, 2;

\echo '== sections with more than one urn; sections without urn or times; origin of the votes'
select turn, count(*) sections, count(*) filter (where urn is null) without_urn, count(*) filter (where opened_at is null) without_opening,
       count(*) filter (where closed_at is null) without_closing, min(opened_at) first_opening, max(closed_at) last_closing
from section_urn group by 1 order by 1;
select turn, origin, origin_desc, count(*) sections, count(*) filter (where divergence is not null) divergent from urn_match group by 1, 2, 3 order by 1, 2;

\echo '== (e) kinds and special values of rdv_votes'
select 'kind ' || k.key kind, count(*) rows from rdv_votes, jsonb_each(votes) k group by 1 order by 1;
select state, turn, office, count(*) rows, sum((votes #>> '{5,""}')::bigint) votes from rdv_votes where votes ? '5' group by 1, 2, 3 order by 1, 2, 3;
select 'blank or null with a number key' check_name, count(*) from rdv_votes r, jsonb_each(r.votes) k, jsonb_each(k.value) n
where k.key in ('3', '4', '5') and n.key <> '';
select 'legend outside the deputy offices' check_name, count(*) from rdv_votes where votes ? '1' and office not in (6, 7, 8);

\echo '== president by round: votes of each candidate'
select t.turn, t.number, e.name, t.votes
from (select r.turn, n.key number, sum(n.value::bigint) votes from rdv_votes r, jsonb_each(r.votes -> '2') n where r.office = 1 group by 1, 2) t
left join elected e on e.state = 'br' and e.turn = t.turn and e.office = 1 and e.number = t.number order by 1, 4 desc;
\echo '-- per round: valid (nominal + legend), blank, null, annulled, turnout, abstention, eligible'
select d.turn, v.valid, v.blank, v.null_votes, v.annulled, d.turnout, d.abstention, d.eligible,
       round(100.0 * d.turnout / d.eligible, 2) turnout_pct, round(100.0 * d.abstention / d.eligible, 2) abstention_pct
from (select turn, sum(turnout) turnout, sum(abstention) abstention, sum(eligible) eligible from section_detail where office = 1 group by 1) d
join (select turn, sum(nominal_votes + legend_votes) valid, sum(blank_votes) blank, sum(null_votes) null_votes, sum(annulled_votes) annulled
      from section_detail where office = 1 group by 1) v using (turn) order by 1;

\echo '== zone totals (detalhe_votacao_munzona) vs section_detail, per municipality, zone, turn and office'
create temp table mz (sg_uf text, city_code text, zone text, turn int, office int, eligible bigint, principal int, aggregated int,
                      not_installed int, total_sections int, turnout bigint, abstention bigint, blank bigint, null_votes bigint, valid bigint);
\copy mz from pstdin csv
create temp table sd as
select city_code, zone, turn, office, count(*) sections, sum(eligible) eligible, sum(turnout) turnout, sum(abstention) abstention,
       sum(blank_votes) blank, sum(null_votes) null_votes, sum(nominal_votes + legend_votes) valid
from section_detail group by 1, 2, 3, 4;
select count(*) zone_rows, count(sd.sections) found_in_sections, count(*) filter (where sd.sections is null) zones_without_sections,
       count(*) filter (where mz.principal <> sd.sections) different_section_count,
       count(*) filter (where mz.eligible <> sd.eligible) different_eligible, count(*) filter (where mz.turnout <> sd.turnout) different_turnout,
       count(*) filter (where mz.abstention <> sd.abstention) different_abstention, count(*) filter (where mz.blank <> sd.blank) different_blank,
       count(*) filter (where mz.null_votes <> sd.null_votes) different_null, count(*) filter (where mz.valid <> sd.valid) different_valid,
       count(*) filter (where mz.valid > sd.valid) zone_valid_higher, count(*) filter (where mz.null_votes < sd.null_votes) zone_null_lower
from mz left join sd using (city_code, zone, turn, office);
select mz.sg_uf, mz.city_code, mz.zone, mz.turn, mz.office, mz.principal, mz.aggregated, mz.not_installed
from mz left join sd using (city_code, zone, turn, office) where sd.sections is null order by 1, 2, 3, 4, 5 limit 20;
select turn, sum(principal) principal, sum(aggregated) aggregated, sum(not_installed) not_installed, sum(total_sections) total from mz where office = 1 group by 1 order by 1;
