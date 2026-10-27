"""Publish observed electoral margins for browser SQL; no inferred transitions."""
import argparse,csv,gzip,hashlib,io,json,subprocess,urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from build import history_data
from contests import families,contest_id
from official_sources import official_unit

ROUND_FIELDS=['contest_id','election_id','year','date','office','state','city','turn','description',
              'electorate','installed','present','absent','not_installed','valid',
              'votes_complete','turnout_complete','source_url','source_sha256','source_year','source_grain','units']
COUNT_FIELDS=['contest_id','state','city','turn','category_id','label','candidate_id','count','source_url','source_sha256','year']
LABELS={'blank':'Brancos','null_native':'Nulos nativos','null_technical':'Nulos técnicos',
        'annulled':'Anulados','annulled_subjudice':'Anulados sub judice','annulled_separate':'Anulados em separado','annulled_urn':'Votos de seções anuladas'}
ROUND_TYPES=['text','text','int','date','int','text','text','int','text','bigint','bigint','bigint','bigint','bigint','bigint','boolean','boolean','text','text','int','text','int']
COUNT_TYPES=['text','text','text','int','text','text','text','bigint','text','text','int']


def number(value):
    return None if value in [None,''] else int(value)


def provenance(rows):
    sources=sorted(set((r.get('source_url') or '',r.get('source_sha256') or '') for r in rows))
    if len(sources)!=1:raise ValueError('multiple source snapshots require an explicit provenance relation')
    return sources[0]


def candidate_identity(contest,number,metadata):
    ident=metadata.get('sourceCandidateId')
    identity=f'tse:{ident}' if ident and str(ident).isdigit() else f"number:{number}:name:{metadata.get('fullName') or metadata['label']}"
    return f'{contest}:{identity}'


def historical_facts(source_year,archive_root):
    elections,units,_=history_data(source_year,archive_root)
    paired=families(elections);groups=defaultdict(list)
    for key,unit in units.items():
        meta=unit['meta'];office=int(meta['office']);city=meta['city_code'] if office==11 else None
        if office==11 and not city:continue  # state totals cannot identify distinct municipal contests
        groups[(meta['election_id'],office,meta['state'],city)].append(unit)
    rounds=[];counts=[]
    for (event,office,state,city),rows in groups.items():
        metadata=[u['meta'] for u in rows];sample=metadata[0];turn=number(sample['turn'])
        family=paired[event];contest=contest_id(family,office,state,city or '')
        date=datetime.strptime(sample['date'],'%d/%m/%Y').date().isoformat() if sample['date'] else None
        year=int(date[:4]) if date else source_year
        def total(field):
            values=[number(m.get(field)) for m in metadata]
            return None if any(v is None for v in values) else sum(values)
        eligible,installed,present,absent=[total(k) for k in ['eligible','installed','present','absent']]
        ni=eligible-installed if eligible is not None and installed is not None else None
        source_url,source_hash=provenance(metadata)
        categories=defaultdict(int);cat_meta={}
        for unit in rows:
            m=unit['meta']
            for column,category in [('blank','blank'),('null','null_native'),('null_technical','null_technical'),
                                    ('annulled','annulled'),('annulled_subjudice','annulled_subjudice'),('annulled_separate','annulled_separate')]:
                value=number(m.get(column))
                if value is not None:
                    categories[category]+=value;cat_meta[category]=(LABELS[category],None,source_url,source_hash)
            for number_,value in unit['votes'].items():
                candidate=unit['candidates'][number_];cid=candidate_identity(contest,number_,candidate);category='candidate:'+cid
                categories[category]+=value
                cat_meta[category]=(candidate['label'],cid,candidate['sourceUrl'],candidate['sourceSha256'])
        # A missing primitive category is not emitted as zero. A complete vote
        # census is asserted only when all observed categories close participation.
        votes_complete=present is not None and sum(categories.values())==present
        turnout_complete=(None not in [eligible,installed,present,absent,ni] and present+absent==installed and installed+ni==eligible)
        rounds.append([contest,event,year,date,office,state,city,turn,sample['description'],eligible,installed,present,absent,ni,total('valid'),
                       votes_complete,turnout_complete,source_url,source_hash,source_year,'+'.join(sorted(set(m['scope'] for m in metadata))),len(rows)])
        for category,value in sorted(categories.items()):
            label,cid,url,digest=cat_meta[category]
            counts.append([contest,state,city,turn,category,label,cid,value,url,digest,year])
    return rounds,counts


def official_config():
    code="import {ELECTIONS} from './src/elections.js'; process.stdout.write(JSON.stringify([ELECTIONS['2026'],ELECTIONS['2026-2']]))"
    return json.loads(subprocess.check_output(['node','--input-type=module','-e',code],text=True))


def fetch_uf(target):
    turn,office,state,event=target
    prefix=f'transfers-2026-{turn}-governor-' if office==3 else ('transfers-2026-1-' if turn==1 else 'turnout-2026-2-')
    path=Path('.cache')/f'{prefix}{state}.json'
    url=f'https://resultados.tse.jus.br/oficial/ele2026/{event}/dados/{state}/{state}-c{office:04d}-e{event:06d}-u.json'
    if not path.exists():
        with urllib.request.urlopen(url,timeout=60) as response:body=response.read()
        json.loads(body);path.write_bytes(body)
    body=path.read_bytes();data=json.loads(body)
    if int(data['ele'])!=event or int(data['t'])!=turn or int(data['carg'][0]['cd'])!=office or data['tpabr']!='uf':
        raise ValueError('wrong official state identity')
    official_unit(data)
    return target,data,url,hashlib.sha256(body).hexdigest()


def official_facts():
    configs=official_config();municipalities=json.loads(Path('.cache/turnout-2026-2-municipalities.json').read_text())
    states=[s['cd'] for s in municipalities['abr']]
    targets=[]
    for config in configs:
        for office in [1,3]:
            for state in states:
                if office==3 and (state=='zz' or config['turn']==2 and state not in config['official']['governors']):continue
                targets.append((config['turn'],office,state,int(config['official']['events'][str(office)])))
    rounds=[];counts=[]
    with ThreadPoolExecutor(max_workers=4) as executor:
        for target,data,url,digest in executor.map(fetch_uf,targets):
            turn,office,state,event=target;config=configs[turn-1]
            family=tuple(f"2026:{c['official']['events'][str(office)]}:{c['turn']}:{c['date']}" for c in configs)
            contest=contest_id(family,office,state);unit=official_unit(data);v=data['v']
            election=f'2026:{event}:{turn}:{config["date"]}'
            rounds.append([contest,election,2026,config['date'],office,state,None,turn,f'Eleição geral 2026 — '+data['carg'][0]['nmn'],
                           unit['eligible'],unit['installed'],unit['present'],unit['absent'],int(data['e']['esni']),int(v['vv']),
                           True,True,url,digest,2026,'state',1])
            categories={k:int(v[field]) for k,field in [('blank','vb'),('null_native','vn'),('null_technical','vnt'),('annulled','van'),('annulled_subjudice','vansj'),('annulled_urn','vsan')]}
            for category,value in categories.items():counts.append([contest,state,None,turn,category,LABELS[category],None,value,url,digest,2026])
            for number_,candidate in unit['candidates'].items():
                cid=candidate_identity(contest,number_,candidate)
                counts.append([contest,state,None,turn,'candidate:'+cid,candidate['label'],cid,unit['votes'][number_],url,digest,2026])
    return rounds,counts


def validate(rounds,counts):
    by_key={}
    for row in rounds:
        record=dict(zip(ROUND_FIELDS,row));key=(record['contest_id'],record['state'],record['turn'])
        if key in by_key:raise ValueError('duplicate observed round identity')
        by_key[key]=record
    totals=defaultdict(int);candidate_totals=defaultdict(int);identities=set()
    for row in counts:
        record=dict(zip(COUNT_FIELDS,row));key=(record['contest_id'],record['state'],record['turn'])
        if key not in by_key:raise ValueError('orphan observed category')
        identity=(*key,record['category_id'])
        if identity in identities:raise ValueError('duplicate observed category')
        if record['count']<0:raise ValueError('negative observed vote count')
        identities.add(identity);totals[key]+=record['count']
        if record['candidate_id'] is not None:candidate_totals[key]+=record['count']
    for key,record in by_key.items():
        if record['votes_complete'] and totals[key]!=record['present']:raise ValueError('complete vote census does not close')
        if record['votes_complete'] and record['valid'] is not None and candidate_totals[key]!=record['valid']:raise ValueError('candidate totals disagree with reported valid votes')
        if record['turnout_complete']:
            if record['present']+record['absent']!=record['installed'] or record['installed']+record['not_installed']!=record['electorate']:
                raise ValueError('complete participation does not close')
    return by_key


def paired_years(rounds):
    groups=defaultdict(set)
    for row in rounds:
        record=dict(zip(ROUND_FIELDS,row))
        if record['office'] in [1,3,11]:groups[(record['year'],record['contest_id'],record['state'])].add(record['turn'])
    return sorted(set(year for (year,_,_),turns in groups.items() if {1,2}.issubset(turns)))


def write_table(name,fields,types,rows,manifest):
    directory=Path('data/state-facts');directory.mkdir(exist_ok=True)
    parts={}
    for year in sorted(set(r[fields.index('year')] for r in rows)):
        selected=[r for r in rows if r[fields.index('year')]==year]
        selected.sort(key=lambda r:tuple('' if v is None else str(v) for v in r[:8]))
        stream=io.StringIO(newline='');writer=csv.writer(stream,lineterminator='\n',quoting=csv.QUOTE_NOTNULL);writer.writerows(selected)
        raw=stream.getvalue().encode();body=gzip.compress(raw,mtime=0);path=directory/f'{name}-{year}.csv.gz';path.write_bytes(body)
        parts[f'{year}/all']={'url':f'state-facts/{path.name}','bytes':len(body),'rawBytes':len(raw),'rows':len(selected),'where':f'year = {year}','sha256':hashlib.sha256(body).hexdigest()}
    columns=','.join(fields);ddl=f'create table {name} ('+', '.join(f'{field} {type_}' for field,type_ in zip(fields,types))+')'
    manifest['tables'][name]={'name':name,'columns':columns,'ddl':ddl,'parts':parts}


def main():
    p=argparse.ArgumentParser();p.add_argument('--archive-root',required=True);args=p.parse_args()
    index=json.loads(Path('data/history/indicators.json').read_text());years=sorted(set(e['year'] for e in index['elections'])-{2026})
    rounds=[];counts=[]
    for year in years:
        a,b=historical_facts(year,args.archive_root);rounds+=a;counts+=b;print(year,len(a),len(b),flush=True)
    a,b=official_facts();rounds+=a;counts+=b
    identities=validate(rounds,counts)
    manifestpath=Path('data/manifest.json');manifest=json.loads(manifestpath.read_text())
    write_table('state_rounds',ROUND_FIELDS,ROUND_TYPES,rounds,manifest);write_table('state_round_counts',COUNT_FIELDS,COUNT_TYPES,counts,manifest)
    fingerprint=hashlib.sha256(json.dumps({t:manifest['tables'][t]['parts'] for t in ['state_rounds','state_round_counts']},sort_keys=True).encode()).hexdigest()
    manifest['version']=manifest['version'].split('+statefacts-')[0]+'+statefacts-'+fingerprint[:16]
    manifest['stateFacts']={'version':1,'scope':'president/governor by UF; mayor by municipality within UF','browserAnalysis':True,'status':'ready','availableYears':sorted(set(r[2] for r in rounds)),'pairedYears':paired_years(rounds),
                            'key':['contest_id','state','turn'],'categoryKey':['contest_id','state','turn','category_id'],
                            'populationRepeatedInCounts':False,'nativeAndTechnicalNullsSeparate':True,'administrativeBalanceObserved':False,
                            'rows':len(rounds),'categories':len(counts),'optionalModels':'transfers/index.json',
                            'definitions':'https://github.com/brauliobo/brazil-audit/blob/main/scripts/transfers/STATE_FACTS.md'}
    temporary=manifestpath.with_suffix('.tmp');temporary.write_text(json.dumps(manifest,ensure_ascii=False,indent=1)+'\n');temporary.replace(manifestpath)
    report={'rounds':len(rounds),'categories':len(counts),'contests':len(set(r[0] for r in rounds)),
            'years':sorted(set(r[2] for r in rounds)),'completeVotes':sum(r[ROUND_FIELDS.index('votes_complete')] for r in rounds),
            'bytes':sum(p['bytes'] for t in ['state_rounds','state_round_counts'] for p in manifest['tables'][t]['parts'].values())}
    Path('data/state-facts/index.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps(report),flush=True)

if __name__=='__main__':main()
