#!/usr/bin/env python3
"""Preserve municipality names from each election's own detailed source, not a current crosswalk."""
import argparse
import csv
import gzip
import hashlib
import io
import json
import zipfile
from collections import defaultdict
from pathlib import Path

from normalize_history import records
from tse_archive import read_json, sha256, write_json
from integrate_electoral_facts import fingerprint
from official_history import election_configs
from candidate_facts import election_identity, source_members

FIELDS=['session_key','election_id','state','city_code','city_name','name_variants','source_election_ids','provenance','source_url','source_sha256','source_year']
TYPES=['text']*5+['jsonb']*3+['text']*2+['int']


def source_resources(catalog):
    seen=set()
    for dataset in catalog['datasets']:
        for source in dataset['resources']:
            if not source.get('inScope') or source['url'] in seen:
                continue
            if any(path in source['url'] for path in ['/detalhe_votacao_uf/','/detalhe_votacao_munzona/']):
                seen.add(source['url']);yield source


def collapse(rows):
    """Keep one territorial-name dimension row, retaining every source spelling and provenance."""
    result={}
    for key,observations in rows.items():
        names=sorted({r['city_name'] for r in observations})
        ids=sorted({r['election_id'] for r in observations})
        sources={json.dumps(dict(election_id=r['election_id'],url=r['source_url'],sha256=r['source_sha256'],year=r['source_year']),sort_keys=True) for r in observations}
        provenance=[json.loads(value) for value in sorted(sources)]
        urls={r['source_url'] for r in observations};hashes={r['source_sha256'] for r in observations};years={r['source_year'] for r in observations}
        session,state,city=key
        result[key]=dict(session_key=session,election_id=ids[0] if len(ids)==1 else None,state=state,city_code=city,
            city_name=' / '.join(names),name_variants=json.dumps(names,ensure_ascii=False,separators=(',',':')),
            source_election_ids=json.dumps(ids,separators=(',',':')),provenance=json.dumps(provenance,ensure_ascii=False,separators=(',',':')),
            source_url=next(iter(urls)) if len(urls)==1 else None,source_sha256=next(iter(hashes)) if len(hashes)==1 else None,
            source_year=next(iter(years)) if len(years)==1 else None)
    return result


def build(root,data_dir):
    registry=read_json(data_dir/'elections.json');events={e['id']:e for e in registry['events']}
    observed=defaultdict(list);missing=[];source_count=0
    for source in source_resources(read_json(root/'catalog/catalog.json')):
        url=source['url'];path=root/'downloads'/hashlib.sha256(url.encode()).hexdigest()/url.split('/')[-1]
        digest=sha256(path)
        if source.get('sha256') and digest!=source['sha256']:
            raise ValueError('detailed source digest mismatch while building electoral place names')
        for row in records(path,dict(source,sha256=digest)):
            if not row['city_code']:
                continue
            if row['city_name'] in [None,'','#NE','#NE#','#NULO#']:
                missing.append(dict(election_id=row['election_id'],state=row['state'],city_code=row['city_code'],source=url));continue
            event=events.get(row['election_id'])
            if event is None:
                raise ValueError(f"place source event is missing from the shared registry: {row['election_id']}")
            key=(event['session_key'],row['state'],row['city_code'])
            observed[key].append(dict(city_name=row['city_name'],election_id=row['election_id'],source_url=url,source_sha256=digest,source_year=row['year']))
        source_count+=1
    # The current runoff has official JSONs but no corresponding summary CSV.
    # Its own archived municipality configuration supplies the names; it is not
    # used as a historical crosswalk for any other election.
    for config in election_configs():
        event_code=str(config['official']['events']['1'])
        candidates=[e for e in events.values() if event_code in e['sourceElectionIds'] and e['turn']==config['turn']
                    and e['dates']==['/'.join(reversed(config['date'].split('-')))]]
        if len(candidates)!=1:raise ValueError('official place configuration needs one exact event binding')
        event=candidates[0];path=Path(f'.cache/turnout-{config["key"]}-municipalities.json')
        document=read_json(path);digest=sha256(path)
        url=f'https://resultados.tse.jus.br/oficial/ele{config["year"]}/{event_code}/config/mun-e{int(event_code):06d}-cm.json'
        for state in document['abr']:
            for city in state['mu']:
                key=(event['session_key'],state['cd'],city['cd'])
                observed[key].append(dict(city_name=city['nm'],election_id=event['id'],source_url=url,source_sha256=digest,source_year=config['year']))
        source_count+=1
    # Registration-only supplementary events can have a different source event
    # code and no detailed-result rows. Their own SG_UE/NM_UE supplies the local
    # constituency label; it is never borrowed from another year's register.
    lookup=defaultdict(list)
    for event in events.values():lookup[(str(event['year']),event['description'])].append(event)
    unbound=set();seen_urls=set()
    for dataset in read_json(root/'catalog/catalog.json')['datasets']:
        for source in dataset['resources']:
            url=source['url']
            if not source.get('inScope') or '/consulta_cand/consulta_cand_' not in url or url in seen_urls:
                continue
            seen_urls.add(url);path=root/'downloads'/hashlib.sha256(url.encode()).hexdigest()/url.split('/')[-1];digest=sha256(path)
            if source.get('sha256') and source['sha256']!=digest:raise ValueError('registration place source digest mismatch')
            with zipfile.ZipFile(path) as archive:
                for member in source_members(archive.namelist()):
                    with archive.open(member) as stream:
                        reader=csv.DictReader(io.TextIOWrapper(stream,encoding='latin1',newline=''),delimiter=';')
                        for raw in reader:
                            if (raw.get('DS_CARGO') or '').upper() not in ['PREFEITO','VICE-PREFEITO','VEREADOR','CONSELHEIRO DISTRITAL']:
                                continue
                            code=raw.get('SG_UE') or '';name=raw.get('NM_UE');state=(raw.get('SG_UF') or '').lower()
                            if not code.isdigit() or not name or name in ['#NE','#NE#','#NULO#']:
                                continue
                            eid=election_identity(raw,lookup);event=events.get(eid)
                            if event is None:unbound.add(eid);continue
                            key=(event['session_key'],state,str(int(code)).zfill(5))
                            observed[key].append(dict(city_name=name,election_id=eid,source_url=url,source_sha256=digest,source_year=int(raw['ANO_ELEICAO'])))
            source_count+=1
    rows=collapse(observed);grouped=defaultdict(list)
    for (session,state,city),row in rows.items():grouped[(session,state)].append(row)
    parts={}
    for (session,state),items in sorted(grouped.items()):
        relative=f'places/{session}/{state}.csv.gz';path=data_dir/relative;path.parent.mkdir(parents=True,exist_ok=True)
        buffer=io.StringIO(newline='');writer=csv.DictWriter(buffer,FIELDS,lineterminator='\n');writer.writerows(sorted(items,key=lambda x:x['city_code']))
        raw=buffer.getvalue().encode();body=gzip.compress(raw,mtime=0);path.write_bytes(body)
        escaped=session.replace("'","''");escaped_state=state.replace("'","''")
        parts[f'{session}/{state}']=dict(url=relative,rows=len(items),bytes=len(body),rawBytes=len(raw),sha256=hashlib.sha256(body).hexdigest(),
            where=f"session_key = '{escaped}' and state = '{escaped_state}'",sessionKeys=[session],states=[state],
            electionIds=sorted({eid for row in items for eid in json.loads(row['source_election_ids'])}),grains=['municipality'])
    definition=dict(name='election_places',columns=','.join(FIELDS),ddl='create table election_places ('+', '.join(f'{field} {typ}' for field,typ in zip(FIELDS,TYPES))+', primary key (session_key,state,city_code))',parts=parts,
        identity=['session_key','state','city_code'],semantics='Names from the same dated electoral session; source election IDs and spelling variants are retained. No current-boundary crosswalk is implied.')
    manifest_path=data_dir/'manifest.json';manifest=read_json(manifest_path);manifest['tables']['election_places']=definition
    manifest['version']=manifest['version'].split('+')[0]+'+facts-'+fingerprint(manifest)
    manifest_path.write_text(json.dumps(manifest,ensure_ascii=False,indent=1)+'\n')
    index=dict(version=1,rows=len(rows),parts=len(parts),sources=source_count,missingNames=missing,unboundRegistrationEvents=sorted(unbound),table='election_places',
        nameMeaning='Municipality labels reported in the election source snapshot; not proof of historical names or boundaries at voting time.')
    write_json(data_dir/'places/index.json',index)
    latest=read_json(data_dir/'elections.json')
    latest['tables']['places']='election_places';latest['places']=dict(index='places/index.json',table='election_places')
    write_json(data_dir/'elections.json',latest)
    return index


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--root',type=Path,default=Path('.cache/tse-archive'));parser.add_argument('--data-dir',type=Path,default=Path('data'))
    args=parser.parse_args();result=build(args.root,args.data_dir);print(json.dumps({k:result[k] for k in ['rows','parts','sources']}),flush=True)
