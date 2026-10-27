#!/usr/bin/env python3
"""Export a compact typed section-fact manifest; municipal coverage stays lazy."""
import argparse
import gzip
import hashlib
import json
import pathlib
from collections import defaultdict
from section_facts import source_resources


def records(directory):
    result={}
    for path in directory.glob('*.json'):
        try:raw=path.read_bytes();record=json.loads(raw)
        except json.JSONDecodeError:continue  # An in-progress source-index write has no ready record yet.
        url=record.get('source',{}).get('source_url') or record.get('url')
        if url:result[url]=(record,hashlib.sha256(raw).hexdigest())
    return result


def build(raw_root,packed_root,catalog_path,registry_path,overlap_proof=None):
    expected={r['url']:r for r in source_resources(json.loads(catalog_path.read_text()))}
    raw=records(raw_root/'sources');packed=records(packed_root/'sources');errors=records(raw_root/'errors')
    registry=json.loads(registry_path.read_text());office_names={(e['id'],o['key']):o['name'] for e in registry['events'] for o in e['offices']}
    known_events={e['id'] for e in registry['events']}
    tables={};inventory=[];profiles={};unknown=set();metadata=[];events={};places={};ballots=[]
    proof=json.loads(overlap_proof.read_text()) if overlap_proof else None
    duplicate_sources={r['source_url']:r for r in proof['duplicates']} if proof else {}
    if proof:
        primary=raw.get(proof['primary']['source_url'])
        if not primary or primary[0]['source']['source_sha256']!=proof['primary']['source_sha256']:
            raise ValueError('The overlap proof does not match the primary source')
    for url,resource in expected.items():
        original=raw.get(url);transport=packed.get(url)
        if not original or original[0].get('status')!='ready':
            inventory.append({'url':url,'status':'error' if url in errors else 'pending','error':errors[url][0] if url in errors else None});continue
        record,input_sha=original
        if url in duplicate_sources:
            duplicate=duplicate_sources[url]
            if record['source']['source_sha256']!=duplicate['source_sha256']:
                raise ValueError('The overlap proof does not match the duplicate source')
            inventory.append({'url':url,'status':'ready','analyticalRole':'verified-duplicate',
                'rows':record['rows'],'source_sha256':record['source']['source_sha256'],
                'primarySource':proof['primary']['source_url'],'equalityProof':duplicate})
            continue
        for event in record.get('events',[]):
            if event['id'] not in known_events or any((event['id'],o['key']) not in office_names for o in event['offices']):
                events[event['id']]=event
            for office in event['offices']:office_names[(event['id'],office['key'])]=office['name']
        for place in record.get('places',[]):
            if place['election_id'] in known_events:continue
            places[(place['election_id'],place['state'],place['city_code'],place['city_name'])]=place
        ballots.extend(record.get('observedBallotOptions',[]))
        if not transport or transport[0].get('inputSha256')!=input_sha:
            inventory.append({'url':url,'status':'packing','rows':record['rows']});continue
        result=transport[0];definition=result['table'];name=definition['name'];year=record['source']['source_year']
        table=tables.setdefault(name,{k:definition[k] for k in ['name','columns','ddl'] }|{'parts':{}})
        if table['columns']!=definition['columns'] or table['ddl']!=definition['ddl']:raise ValueError('Section source schemas disagree')
        role='sections' if name=='election_section_votes' else 'section-units'
        for key,part in definition['parts'].items():
            part={**part,'localFile':part['url'],'sourceYears':[year],'role':role}
            table['parts'][key]=part
            unknown.update(set(part['electionIds'])-known_events)
        for coverage in result['observedCoverage']:
            event,office,state=coverage['election_id'],coverage['office_key'],coverage['state']
            profile=profiles.setdefault((event,office),dict(election_id=event,office=coverage['office'],office_key=office,
                office_name=office_names.get((event,office)),states=set(),grains=['section'],tables=set(),sectionResults=False,
                browserRdv=False,countMeaning='observed_cast',coverageByState={}))
            if state:profile['states'].add(state)
            profile['tables'].add(name)
            profile['sectionResults']|=name=='election_section_votes'
            summary=profile['coverageByState'].setdefault(state or '',{'state':state,'voteSections':None,'referenceSections':None,'nominalCast':None,'referenceNominalReported':None})
            if role=='sections':
                summary['voteSections']=(summary['voteSections'] or 0)+coverage['sections'];summary['nominalCast']=(summary['nominalCast'] or 0)+coverage['counts'].get('candidate',0)
            else:
                had_reference=summary['referenceSections'] is not None
                summary['referenceSections']=(summary['referenceSections'] or 0)+coverage['sections']
                value=coverage['counts'].get('nominal_reported')
                summary['referenceNominalReported']=None if value is None or had_reference and summary['referenceNominalReported'] is None else (summary['referenceNominalReported'] or 0)+value
        for metric_coverage in result.get('metricCoverage',[]):
            profile=profiles[(metric_coverage['election_id'],metric_coverage['office_key'])]
            profile['rows']=profile.get('rows',0)+metric_coverage['rows']
            metrics=profile.setdefault('metrics',{})
            for field,counts in metric_coverage['metrics'].items():
                total=metrics.setdefault(field,dict(knownRows=0,totalRows=0))
                for name in ['knownRows','totalRows']:total[name]+=counts[name]
        source_key=hashlib.sha256(url.encode()).hexdigest();payload=json.dumps(result,ensure_ascii=False,separators=(',',':')).encode();payload=gzip.compress(payload,mtime=0)
        relative=f'source-metadata/{source_key}.json.gz';path=packed_root/relative;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(payload)
        metadata.append({'source_url':url,'url':relative,'localFile':relative,'sha256':hashlib.sha256(payload).hexdigest(),'bytes':len(payload),'rows':record['rows']})
        inventory.append({'url':url,'status':'ready','rows':record['rows'],'source_sha256':record['source']['source_sha256'],'sourceYear':year,'parts':len(definition['parts']),'coverageUrl':relative})
    for p in profiles.values():
        p['states']=sorted(p['states']);p['tables']=sorted(p['tables']);p['coverageByState']=list(p['coverageByState'].values())
        for coverage in p['coverageByState']:
            coverage['sameSectionCounts']=coverage['voteSections']==coverage['referenceSections'] if None not in [coverage['voteSections'],coverage['referenceSections']] else None
            # Equal cardinalities do not prove equal section identities.
            coverage['complete']=False if coverage['sameSectionCounts'] is False else None
    summary={status:sum(r['status']==status for r in inventory) for status in ['ready','packing','pending','error']}
    result={'version':1,'status':'ready' if summary['ready']==len(expected) and not (unknown-set(events)) else 'preparing','expectedSources':len(expected),'sourceCounts':summary,
        'tables':tables,'eventOffices':list(profiles.values()),'sourceMetadata':metadata,'sources':inventory,'unregisteredEvents':sorted(unknown-set(events)),
        'events':list(events.values()),'places':list(places.values()),'observedBallotOptions':ballots,
        'semantics':{'election_section_votes':'Observed cast counts, including native blank/null/separate categories; never substituted for valid nominal totals.',
                     'election_section_units':'Native section-detail quantities; never added to official geographic rollups.'}}
    target=packed_root/'index.json';temporary=target.with_suffix('.tmp');temporary.write_text(json.dumps(result,ensure_ascii=False,indent=1)+'\n');temporary.replace(target)
    print(json.dumps({'sources':summary,'events':len(profiles),'unknownEvents':len(unknown-set(events)),'indexBytes':target.stat().st_size,'parts':sum(len(t['parts']) for t in tables.values())}),flush=True)
    return result

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--input',type=pathlib.Path,required=True);p.add_argument('--packed',type=pathlib.Path,required=True);p.add_argument('--catalog',type=pathlib.Path,required=True);p.add_argument('--overlap-proof',type=pathlib.Path);p.add_argument('--registry',type=pathlib.Path,default=pathlib.Path('data/elections.json'));a=p.parse_args();build(a.input,a.packed,a.catalog,a.registry,a.overlap_proof)
