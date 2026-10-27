"""Describe browser availability from normalized source evidence, not archive status."""
from collections import defaultdict

from tse_archive import read_json, write_json


def update(data_dir, registry, fragment_paths):
    catalog_path=data_dir/'history/catalog.json'
    if not catalog_path.exists():return
    sources=defaultdict(lambda:dict(indexes=set(),tables=set(),sessionKeys=set(),profileSnapshotYears=set()))
    event_sessions=defaultdict(set)
    for event in registry['events']:
        for url in event['sources']:event_sessions[url].add(event['session_key'])
    def add(url,index,tables,years=()):
        item=sources[url];item['indexes'].add(index);item['tables'].update(tables)
        item['sessionKeys'].update(event_sessions[url]);item['profileSnapshotYears'].update(years)
    for event in read_json(data_dir/'history/indicators.json')['elections']:
        for url in event['sources']:add(url,'history/indicators.json',['election_units'])
    profile_path=data_dir/'profiles/index.json'
    if profile_path.exists():
        for dataset in read_json(profile_path)['datasets']:
            add(dataset['sourceUrl'],'profiles/index.json',['election_profiles'],dataset['years'])
    for path in fragment_paths:
        fragment=read_json(path);index=str(path.relative_to(data_dir))
        for item in fragment.get('eventOffices',[]):
            for url in item.get('sources',[]):add(url,index,item['tables'])
        # Native source inventories explicitly distinguish their section roles;
        # their collection-level table set is not a per-resource column claim.
        for item in fragment.get('sources',[]):
            if item.get('status')=='ready':add(item['url'],index,list(fragment['tables']))
    sessions={s['key']:s for s in registry['sessions']}
    catalog=read_json(catalog_path)
    for dataset in catalog['datasets']:
        aggregate=dict(indexes=set(),tables=set(),sessionKeys=set(),profileSnapshotYears=set())
        for resource in dataset['resources']:
            item=sources.get(resource['url'])
            if item:
                for key in aggregate:aggregate[key].update(item[key])
                resource['browserNormalized']=dict(available=True,scope='selected-facts',**{k:sorted(v) for k,v in item.items() if k!='tables'})
        if not aggregate['tables']:continue
        # A profile link selects an existing ordinary year's UI context; it is
        # explicitly not a join between a snapshot and that contest population.
        for year in aggregate['profileSnapshotYears']:
            if str(year) in sessions:aggregate['sessionKeys'].add(str(year))
        descriptor=dict(available=True,scope='selected-facts',**{k:sorted(v) for k,v in aggregate.items()})
        preferred=[str(y) for y in dataset['years'] if str(y) in aggregate['sessionKeys']]
        candidates=preferred or sorted(aggregate['sessionKeys'],key=lambda k:(sessions[k]['year'],sessions[k].get('date') or '',k))
        if candidates:descriptor['sessionKey']=candidates[0]
        if aggregate['profileSnapshotYears']:descriptor['context']='independent-profile-snapshot'
        dataset['browserNormalized']=descriptor
    write_json(catalog_path,catalog)
