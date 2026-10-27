// Public source declarations; these are not observed seat-allocation outcomes.
export const NOMINATION_TABLES=['election_lists','election_declared_seats','candidate_list_links']
export const NOMINATION_NAMES=['lists','seats','links']
export const NOMINATION_COLUMNS={
 common:['source_year','turn','election_date','description','office_name','office_constituency_grain','state','constituency','constituency_name','constituency_grain'],
 election_lists:['list_id','list_kind','party_number','party','party_name','coalition_acronym','coalition_name','composition','federation_number','federation_name','federation_acronym','federation_composition','list_status','destination'],
 election_declared_seats:['seats'],candidate_list_links:['source_candidate_id','candidate_number','name','short_name','party_number','party','party_name','composition','list_kind','candidate_status','candidate_id'],
}
export const NOMINATION_FIELDS=[...new Set([...Object.values(NOMINATION_COLUMNS).flat(),'binding_kind'])]
