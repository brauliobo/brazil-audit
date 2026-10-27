"""Canonical election-family identities derived from published event metadata."""
import hashlib,json,re
from datetime import datetime


def election_pairs(elections):
    def base(e):
        text=re.sub(r'(?:primeiro|segundo|1[.º°o]?|2[.º°o]?)\s*turno','',e['description'],flags=re.I)
        return re.sub(r'[\s-]+',' ',text).strip().casefold(),tuple(e.get('electionTypes',[]))
    pairs=[]
    for second in elections.values():
        if second['turn']!=2:continue
        candidates=[e for e in elections.values() if e['turn']==1 and base(e)==base(second)]
        if second.get('dates'):
            end=datetime.strptime(second['dates'][0],'%d/%m/%Y')
            candidates=[e for e in candidates if len(e.get('dates',[]))==1 and 0<(end-datetime.strptime(e['dates'][0],'%d/%m/%Y')).days<=45]
        if len(candidates)==1:pairs.append((candidates[0]['id'],second['id']))
    return pairs


def families(elections):
    result={ident:(ident,) for ident in elections}
    for pair in election_pairs(elections):
        for ident in pair:result[ident]=pair
    return result


def contest_id(family,office,state,city=''):
    scope='br' if int(office)==1 else state+(f':{city}' if int(office)==11 else '')
    digest=hashlib.sha256(json.dumps(list(family),ensure_ascii=False).encode()).hexdigest()[:16]
    return f'{office}:{scope}:{digest}'
