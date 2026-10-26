"""Exact office-specific margins from complete official JSON snapshots."""
import hashlib,json
from collections import defaultdict
from pathlib import Path


def official_unit(data):
    e,v=data['e'],data['v']
    if int(v['vn'])+int(v['vnt'])!=int(v['tvn']):raise ValueError('official null-vote decomposition disagrees')
    votes=defaultdict(int,blank=int(v['vb']),null=int(v['tvn']),
                      annulled=int(v['van']),annulled_subjudice=int(v['vansj']),annulled_urn=int(v['vsan']))
    candidates={}
    for group in data['carg'][0]['agr']:
        for party in group['par']:
            for c in party.get('cand',[]):
                if c['dvt']!='Válido':continue
                votes[c['n']]+=int(c['vap']);candidates[c['n']]={'label':c['nm'],'sourceCandidateId':c['sqcand']}
    unit={'eligible':int(e['te']),'installed':int(e['esi']),'present':int(e['c']),'absent':int(e['a']),'votes':votes,'candidates':candidates}
    if unit['present']+unit['absent']!=unit['installed'] or unit['installed']+int(e['esni'])!=unit['eligible']:
        raise ValueError('official participation does not reconcile')
    if sum(votes.values())!=unit['present']:raise ValueError('official vote categories do not reconcile')
    return unit


def verify_total(parent,children):
    for field in ['eligible','installed','present','absent']:
        if sum(u[field] for u in children)!=parent[field]:raise ValueError('official territorial margins disagree: '+field)
    categories=set(parent['votes'])|set(k for u in children for k in u['votes'])
    for category in categories:
        if sum(u['votes'].get(category,0) for u in children)!=parent['votes'].get(category,0):
            raise ValueError('official territorial vote margins disagree: '+category)


def governors_2026():
    availability=json.loads(Path('.cache/transfers-governor-availability.json').read_text())
    units={};sources=[]
    for target in availability:
        if target['status']!='available':continue
        path=Path('.cache')/target['cache'];data=json.loads(path.read_text())
        if int(data['ele'])!=target['event'] or int(data['t'])!=target['turn'] or data['carg'][0]['cd']!='3':
            raise ValueError('wrong official governor election')
        if data['tpabr']!={'uf':'uf','city':'mu','zone':'zona'}[target['scope']]:raise ValueError('wrong official scope')
        key=(target['turn'],target['state'],target['code'],target['zone'] or '')
        if key in units:raise ValueError('duplicate official governor identity')
        units[key]=official_unit(data)
        sources.append({'url':target['url'],'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
    states=sorted(set(k[1] for k in units))
    for turn in [1,2]:
        for state in states:
            cities={k:u for k,u in units.items() if k[0]==turn and k[1]==state and k[2] and not k[3]}
            verify_total(units[(turn,state,'','')],list(cities.values()))
            for key,city in cities.items():
                zones=[u for k,u in units.items() if k[:3]==key[:3] and k[3]]
                verify_total(city,zones)
    return units,sources
