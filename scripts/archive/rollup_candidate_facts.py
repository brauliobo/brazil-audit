#!/usr/bin/env python3
"""Small observed territorial margins plus independently lazy original candidate-vote facts."""
import argparse,concurrent.futures,csv,gzip,hashlib,io,json,pathlib
from collections import defaultdict
from candidate_facts import VOTE_FIELDS,VOTE_TYPES,CAND_FIELDS,CAND_TYPES
NAMES={'president':'Presidente','governor':'Governador','senator':'Senador','federal_deputy':'Deputado Federal','state_deputy':'Deputado Estadual','district_deputy':'Deputado Distrital','mayor':'Prefeito','councillor':'Vereador'}

def describe(path,fields,count,where,offices,data_root):
    data=path.read_bytes()
    return {'url':str(path.relative_to(data_root)),'rows':count,'bytes':len(data),'rawBytes':len(gzip.decompress(data)),'sha256':hashlib.sha256(data).hexdigest(),'where':where,'offices':offices}

def process_year(index_path,output,data_root=pathlib.Path('.cache/canonical-source-data')):
    index=json.loads(index_path.read_text());year=index_path.parent.name
    target=output/year;target.mkdir(parents=True,exist_ok=True)
    parts={};detail={};events={}
    for part_id,p in index['tables']['election_votes']['parts'].items():
        source=data_root/p['url'];grouped=defaultdict(int);detail_handles={};detail_writers={};detail_counts=defaultdict(int)
        with gzip.open(source,'rt') as f:
            for row in csv.reader(f):
                r=dict(zip(VOTE_FIELDS,row));office=r['office'];ok=r['office_key'];e=events.setdefault((r['election_id'],ok),{'election_id':r['election_id'],'office':office,'office_key':ok,'office_name':NAMES.get(ok,ok.split(':',2)[-1]),'states':set(),'grains':set(),'rows':0,'tables':['election_vote_rollups','election_votes','election_candidates'],'candidates':set(),'partyMetadata':False})
                e['states'].add(r['state']);e['grains'].add(r['grain']);e['rows']+=1
                # The state/municipal summary is a source normalization, not a model or inferred voter flow.
                local=(ok in ['mayor','councillor'] or ok.endswith((':VICE-PREFEITO',':CONSELHEIRO DISTRITAL'))) and r['city_code']!=''
                r['grain']='municipality' if local else 'state';r['city_code']=r['constituency'] if local else '';r['zone']='';r['section']=''
                key=tuple(r[k] for k in VOTE_FIELDS if k!='votes');grouped[key]+=int(r['votes'])
                if office not in detail_writers:
                    path=target/f'election_votes-{year}-{r["state"]}.{office}.csv.gz';handle=io.TextIOWrapper(gzip.GzipFile(filename='',fileobj=open(path,'wb'),mode='wb',compresslevel=6,mtime=0),encoding='utf8',newline='');detail_handles[office]=handle;detail_writers[office]=csv.writer(handle,lineterminator='\n')
                detail_writers[office].writerow(row);detail_counts[office]+=1
        for h in detail_handles.values():h.close()
        state=part_id.split('/')[1]
        for office,count in detail_counts.items():
            path=target/f'election_votes-{year}-{state}.{office}.csv.gz'
            detail[f'{year}/{state}.{office}']=describe(path,VOTE_FIELDS,count,f"source_year = {year} and state = '{state}' and office = '{office}'",[int(office)] if office.isdigit() else [],data_root)
        handles={};writers={};counts=defaultdict(int)
        for key,count in grouped.items():
            r=dict(zip([k for k in VOTE_FIELDS if k!='votes'],key));r['votes']=count;office=r['office']
            if office not in writers:
                path=target/f'election_vote_rollups-{year}-{state}.{office}.csv.gz';handle=io.TextIOWrapper(gzip.GzipFile(filename='',fileobj=open(path,'wb'),mode='wb',compresslevel=6,mtime=0),encoding='utf8',newline='');handles[office]=handle;writers[office]=csv.writer(handle,lineterminator='\n')
            writers[office].writerow([r[k] for k in VOTE_FIELDS]);counts[office]+=1
        for h in handles.values():h.close()
        for office,count in counts.items():
            path=target/f'election_vote_rollups-{year}-{state}.{office}.csv.gz'
            parts[f'{year}/{state}.{office}']=describe(path,VOTE_FIELDS,count,f"source_year = {year} and state = '{state}' and office = '{office}'",[int(office)] if office.isdigit() else [],data_root)
    for p in index['tables']['election_candidates']['parts'].values():
        with gzip.open(data_root/p['url'],'rt') as f:
            for values in csv.reader(f):
                c=dict(zip(CAND_FIELDS,values));e=events.get((c['election_id'],c['office_key']))
                if e:
                    if c['candidate_id'].startswith('candidate:'):e['candidates'].add(c['candidate_id'])
                    e['partyMetadata']|=bool(c['party'])
    for e in events.values():
        for k in ['states','grains']:e[k]=sorted(e[k])
        e['candidateCount']=len(e.pop('candidates'));e['candidateCounts']=True
    print(json.dumps({'year':year,'rollupRows':sum(p['rows'] for p in parts.values()),'detailRows':sum(p['rows'] for p in detail.values())}),flush=True)
    return parts,detail,list(events.values())

def build(source,output,workers=4,data_root=pathlib.Path('.cache/canonical-source-data')):
    indices=sorted(source.glob('[12][0-9][0-9][0-9]/index.json'));tables={};events=[]
    with concurrent.futures.ProcessPoolExecutor(max_workers=workers) as pool:
        # gzip/CSV streaming is bounded by a year; no full archive dataframe is materialized.
        jobs=[pool.submit(process_year,p,output,data_root) for p in indices]
        results=[job.result() for job in jobs]
    rollups={};details={};candidates={};sources=[]
    for path,(r,d,e) in zip(indices,results):
        rollups.update(r);details.update(d);events+=e;index=json.loads(path.read_text());candidates.update(index['tables']['election_candidates']['parts']);sources+=index['sources']
    for name,fields,types,parts in [('election_vote_rollups',VOTE_FIELDS,VOTE_TYPES,rollups),('election_votes',VOTE_FIELDS,VOTE_TYPES,details),('election_candidates',CAND_FIELDS,CAND_TYPES,candidates)]:
        tables[name]={'name':name,'columns':','.join(fields),'ddl':f'create table {name} ('+', '.join(f'{k} {t}' for k,t in zip(fields,types))+')','parts':parts}
    result={'tables':tables,'eventOffices':events,'sources':sources,'normalization':'Rollups sum source candidate/list observations by UF, or by municipality for local contests; original finer observations remain separately loadable.'}
    output.mkdir(parents=True,exist_ok=True);(output/'index.json').write_text(json.dumps(result,ensure_ascii=False,indent=1)+'\n');return result
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--staging-root',type=pathlib.Path,default=pathlib.Path('.cache/canonical-source-data'));p.add_argument('--source',type=pathlib.Path);p.add_argument('--output',type=pathlib.Path);p.add_argument('--workers',type=int,default=4);a=p.parse_args();build(a.source or a.staging_root/'history/facts',a.output or a.staging_root/'history/result-facts',a.workers,a.staging_root)
