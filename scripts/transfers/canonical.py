"""Select one complete territorial antichain, never sum overlapping rollups."""
from collections import defaultdict

FIELDS=['eligible','installed','present','absent','blank','null','valid',
        'annulled','annulled_subjudice','annulled_separate']


def verify_parent(parent,children):
    for field in FIELDS:
        value=parent.get(field)
        if value in [None,'']:continue
        parts=[r.get(field) for r in children]
        if any(v in [None,''] for v in parts):raise ValueError(f'incomplete child field {field}')
        if sum(int(v) for v in parts)!=int(value):raise ValueError(f'territorial rollups disagree: {field}')


def canonical_records(records):
    """Prefer finest complete published units; reject inconsistent hierarchies."""
    by_election=defaultdict(list)
    for row in records:by_election[(row['election_id'],row['office'])].append(row)
    selected=[]
    for rows in by_election.values():
        national=[r for r in rows if r['scope']=='national']
        if len(national)>1:raise ValueError('duplicate national identity')
        states=defaultdict(list)
        for row in rows:
            if row['scope']!='national':states[row['state']].append(row)
        chosen_states=[]
        for state_rows in states.values():
            parent=[r for r in state_rows if r['scope']=='state']
            if len(parent)>1:raise ValueError('duplicate state identity')
            cities=defaultdict(list)
            for row in state_rows:
                if row['scope'] in ['municipality','city','zone']:cities[row['city_code']].append(row)
            chosen=[]
            for city_rows in cities.values():
                city=[r for r in city_rows if r['scope'] in ['municipality','city']]
                zones=[r for r in city_rows if r['scope']=='zone']
                if len(city)>1:raise ValueError('duplicate municipality identity')
                if len({r['zone'] for r in zones})!=len(zones):raise ValueError('duplicate zone identity')
                if zones:
                    if city:verify_parent(city[0],zones)
                    chosen.extend(zones)
                else:chosen.extend(city)
            if chosen:
                if parent:verify_parent(parent[0],chosen)
                chosen_states.extend(chosen)
            else:chosen_states.extend(parent)
        if chosen_states:
            if national:verify_parent(national[0],chosen_states)
            selected.extend(chosen_states)
        else:selected.extend(national)
    return selected
