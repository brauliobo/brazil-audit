-- The checks of the voting machine data (rdv_machine, voting_times, machine_sections) against the open data tables of the
-- same database. From the root of the repository: psql -d brazil-audit-2022 -f test/verify_machine.sql
\pset pager off

\echo '== units imported: sections, events, ballots, lines of a vote that did not match, rows not stored (events of other days, second RDVs)'
select substring(name from 'machine/(\d)t') turn, count(*) units, sum(rows) sections, sum(loaded) events, sum(votes) ballots, sum(unclassified) garbled, sum(skipped) skipped
from imports where name like 'machine/%' group by 1 order by 1;

\echo '== (a) RDV vs the open data (rdv_votes), per section, turn and office: nominal and legend votes by number, blank and null by total'
-- the RDV keeps the digits typed: a legend vote (kind 1) is counted by party, the first 2 digits; the nulls of the open data are the
-- kind 4 (a number that does not exist) and the kind 6 (no number) of the RDV
create temp table entries as
select 'machine' src, state, city_code, zone, section, turn, office, case k.key when '6' then 4 else k.key::int end kind,
       case k.key when '1' then left(n.key, 2) when '2' then n.key else '' end number, sum(n.value::bigint) votes
from rdv_machine m, jsonb_each(m.votes) k, jsonb_each(k.value) n group by 2, 3, 4, 5, 6, 7, 8, 9
union all
select 'open', state, city_code, zone, section, turn, office, k.key::int, case k.key when '1' then n.key when '2' then n.key else '' end, sum(n.value::bigint)
from rdv_votes m, jsonb_each(m.votes) k, jsonb_each(k.value) n
where (state, city_code, zone, section, turn) in (select state, city_code, zone, section, turn from rdv_machine) group by 2, 3, 4, 5, 6, 7, 8, 9;
create index on entries (state, city_code, zone, section, turn, office);
create temp table gap as
select coalesce(a.state, b.state) state, coalesce(a.city_code, b.city_code) city_code, coalesce(a.zone, b.zone) zone, coalesce(a.section, b.section) section,
       coalesce(a.turn, b.turn) turn, coalesce(a.office, b.office) office, coalesce(a.kind, b.kind) kind, coalesce(a.number, b.number) number,
       coalesce(a.votes, 0) machine, coalesce(b.votes, 0) open
from (select * from entries where src = 'machine') a full join (select * from entries where src = 'open') b using (state, city_code, zone, section, turn, office, kind, number);
select count(*) section_offices, count(*) filter (where not differs) identical, count(*) filter (where differs) different,
       coalesce(sum(abs_diff), 0) abs_votes_difference
from (select state, city_code, zone, section, turn, office, bool_or(machine <> open) differs, sum(abs(machine - open)) abs_diff from gap group by 1, 2, 3, 4, 5, 6) t;
select turn, office, kind, count(distinct (state, city_code, zone, section)) sections_different, sum(abs(machine - open)) abs_votes, sum(machine - open) net_votes,
       max(abs(machine - open)) biggest
from gap where machine <> open group by 1, 2, 3 order by 1, 2, 3;
\echo '-- sections with RDV only in the machine data, or only in the open data (only the ones with an RDV are compared)'
select turn, count(*) filter (where o.state is null) rdv_without_open_data_rows, count(*) section_offices
from rdv_machine m left join rdv_votes o using (state, city_code, zone, section, turn, office) group by 1 order by 1;
select m.turn, count(*) open_data_rows_without_rdv
from rdv_votes m where m.turn in (select distinct turn from rdv_machine) and m.state in (select distinct state from rdv_machine)
and not exists (select 1 from rdv_machine r where (r.state, r.city_code, r.zone, r.section, r.turn, r.office) = (m.state, m.city_code, m.zone, m.section, m.turn, m.office)) group by 1 order by 1;

\echo '== (b) confirmed votes in the log vs ballots of the RDV, per section and office'
create temp table ev as
select state, city_code, zone, section, turn,
       case post when 'Presidente' then 1 when 'Governador' then 3 when 'Senador' then 5 when 'Deputado Federal' then 6 when 'Deputado Estadual' then 7
                 when 'Deputado Distrital' then 8 else 0 end office, count(*) events
from voting_times group by 1, 2, 3, 4, 5, 6;
create temp table bal as
select state, city_code, zone, section, turn, office, (select sum(n.value::bigint) from jsonb_each(votes) k, jsonb_each(k.value) n) ballots from rdv_machine;
select 'posts that are no office' check_name, count(*) from ev where office = 0;
select turn, office, count(*) section_offices, count(*) filter (where events = ballots) equal, count(*) filter (where events < ballots) fewer_events,
       count(*) filter (where events > ballots) more_events, sum(ballots - events) filter (where events < ballots) missing_events,
       sum(events - ballots) filter (where events > ballots) extra_events, sum(ballots) ballots, sum(events) events
from bal join ev using (state, city_code, zone, section, turn, office) group by 1, 2 order by 1, 2;
select turn, count(*) section_offices, count(*) filter (where events is null) rdv_office_without_events,
       count(*) filter (where abs(ballots - coalesce(events, 0)) = 1) differ_by_one, count(*) filter (where abs(ballots - coalesce(events, 0)) between 2 and 5) differ_2_to_5,
       count(*) filter (where abs(ballots - coalesce(events, 0)) > 5) differ_over_5, max(abs(ballots - coalesce(events, 0))) biggest
from bal left join ev using (state, city_code, zone, section, turn, office) group by 1 order by 1;

\echo '== (c) sections with RDV but no log, and with a log but no RDV'
select turn, count(*) sections, count(*) filter (where rdvs > 0 and logs = 0) rdv_without_log, count(*) filter (where rdvs = 0 and logs > 0) log_without_rdv,
       count(*) filter (where logs = 2) two_logs, count(*) filter (where rdvs > 1) two_rdvs, count(*) filter (where logs > 0 and events = 0) log_without_events
from machine_sections group by 1 order by 1;
\echo '-- the open data sections that have no machine files at all, by turn (with votes in the open data)'
select o.turn, count(*) sections_without_machine_files
from (select distinct state, city_code, zone, section, turn from rdv_votes) o
where o.turn in (select distinct turn from machine_sections) and o.state in (select distinct state from machine_sections)
and not exists (select 1 from machine_sections s where (s.state, s.city_code, s.zone, s.section, s.turn) = (o.state, o.city_code, o.zone, o.section, o.turn)) group by 1 order by 1;
select 'models' check_name, model, count(*) sections from machine_sections group by 2 order by 3 desc;

\echo '== (d) first and last confirmed vote vs the opening and closing of the section (section_urn)'
select s.turn, count(*) sections, count(*) filter (where u.opened_at is null or s.first_vote is null) not_comparable,
       count(*) filter (where s.first_vote < u.opened_at) first_before_opening, count(*) filter (where s.last_vote > u.closed_at) last_after_closing,
       count(*) filter (where s.first_vote >= u.opened_at and s.last_vote <= u.closed_at) inside,
       min(s.first_vote - u.opened_at) earliest_vs_opening, max(s.first_vote - u.opened_at) latest_first_vote, max(s.last_vote - u.closed_at) latest_vs_closing,
       min(s.last_vote - s.first_vote) shortest_voting, max(s.last_vote - s.first_vote) longest_voting
from machine_sections s join section_urn u using (state, city_code, zone, section, turn) group by 1 order by 1;
select s.turn, count(*) first_vote_more_than_5min_before_opening, min(s.first_vote - u.opened_at) most
from machine_sections s join section_urn u using (state, city_code, zone, section, turn) where s.first_vote < u.opened_at - interval '5 minutes' group by 1 order by 1;
select s.turn, count(*) last_vote_more_than_5min_after_closing, max(s.last_vote - u.closed_at) most
from machine_sections s join section_urn u using (state, city_code, zone, section, turn) where s.last_vote > u.closed_at + interval '5 minutes' group by 1 order by 1;
select turn, date_trunc('hour', first_vote)::time first_hour, count(*) from machine_sections where first_vote is not null group by 1, 2 order by 1, 2;
select turn, date_trunc('hour', last_vote)::time last_hour, count(*) from machine_sections where last_vote is not null group by 1, 2 order by 1, 2;
