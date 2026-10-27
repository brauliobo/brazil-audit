#!/usr/bin/env python3
"""Source-faithful candidate/list vote facts, preserving pleito and territorial identity."""
import argparse,csv,gzip,hashlib,io,itertools,json,pathlib,re,sys,zipfile
from contextlib import contextmanager
from functools import lru_cache
from collections import defaultdict
from normalize_history import office_key,number,normalize

LEGACY_CANDIDATE=['DATA_GERACAO','HORA_GERACAO','ANO_ELEICAO','NUM_TURNO','DESC_ELEICAO','SIGLA_UF','SIGLA_UE','COD_CARGO','NUMERO_CAND','SEQ_CANDIDATO','NOME_CANDIDATO','NOME_URNA_CAND','DESC_CARGO','COD_SIT_CAND_SUPERIOR','DESC_SIT_CAND_SUPERIOR','COD_SIT_CAND','DESC_SIT_CAND','COD_SIT_CAND_TOT','DESC_SIT_CAND_TOT','NUMERO_PARTIDO','SIGLA__PARTIDO','NOME_PARTIDO','SEQUENCIAL_LEGENDA','NOME_LEGENDA','COMPOSICAO_LEGENDA','TOTAL_VOTOS']
LEGACY_PARTY=['DATA_GERACAO','HORA_GERACAO','ANO_ELEICAO','NUM_TURNO','DESC_ELEICAO','SIGLA_UF','SIGLA_UE','COD_CARGO','DESC_CARGO','TIPO_LEGENDA','NOME_COLIGACAO','COMPOSICAO_COLIGACAO','SIGLA_PARTIDO','NUMERO_PARTIDO','NOME_PARTIDO','TOTAL_VOTOS_NOMINAIS','TOTAL_VOTOS_LEGENDA']
VOTE_FIELDS=['election_id','grain','state','city_code','zone','section','office','office_key','constituency','candidate_id','kind','number','votes','destination','transit','source_url','source_sha256','source_year']
CAND_FIELDS=['election_id','state','office','office_key','constituency','candidate_id','number','name','short_name','party_number','party','party_name','status','status_code','source_candidate_id','source_url','source_sha256','source_year']
VOTE_TYPES=['text']*12+['bigint']+['text']*4+['int']
CAND_TYPES=['text']*(len(CAND_FIELDS)-1)+['int']


@contextmanager
def gzip_text(path, level=6):
    with open(path,'wb') as raw:
        with gzip.GzipFile(filename='',fileobj=raw,mode='wb',compresslevel=level,mtime=0) as zipped:
            with io.TextIOWrapper(zipped,encoding='utf8',newline='') as text:
                yield text


def clean(value):
    return None if value in [None,'','-1','-3','#NE','#NE#','#NULO#'] else value


def first(row,*names):
    return next((clean(row.get(k)) for k in names if clean(row.get(k)) is not None),None)


def election_identity(row,lookup):
    if row.get('CD_ELEICAO'):
        turn=number(row.get('NR_TURNO'));date=row.get('DT_ELEICAO') or ''
        return f"{number(row['ANO_ELEICAO'])}:{row['CD_ELEICAO']}:{turn if turn is not None else 'na'}"+(':'+ '-'.join(reversed(date.split('/'))) if date else '')
    year=str(row['ANO_ELEICAO']);description=row.get('DESC_ELEICAO','')
    matches=lookup.get((year,description),[])
    if len(matches)==1:return matches[0]['id']
    turn=number(row.get('NUM_TURNO'))
    exact=[e for e in matches if e['turn']==turn]
    if len(exact)==1:return exact[0]['id']
    if matches:raise ValueError('ambiguous legacy election identity')
    return normalize(row,{'url':'','id':''})['election_id']


@lru_cache(maxsize=1000000)
def candidate_hash(key):
    return hashlib.sha256(json.dumps(key,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()[:24]

def source_members(names):
    data=[n for n in names if n.lower().endswith(('.csv','.txt'))]
    national=[n for n in data if '_BRASIL.' in n.upper()]
    if len(national)>1:raise ValueError('Multiple national data representations require an explicit source profile')
    return national if national else data

def office_jurisdiction(key):
    if key=='president' or key.endswith(':VICE-PRESIDENTE'):return 'national'
    if key in ['mayor','councillor'] or key.endswith((':VICE-PREFEITO',':CONSELHEIRO DISTRITAL')):return 'municipality'
    if key in ['governor','senator','federal_deputy','state_deputy','district_deputy'] or key.endswith((':VICE-GOVERNADOR',':DEPUTADO')):return 'state'
    return 'reported_context'

def identity(row,lookup,kind,context=None):
    election=election_identity(row,lookup)
    office=first(row,'CD_CARGO','COD_CARGO') or ''
    name=first(row,'DS_CARGO','DESC_CARGO') or ''
    state=(first(row,'SG_UF','SIGLA_UF') or '').lower()
    city=number(row.get('CD_MUNICIPIO'));zone=number(row.get('NR_ZONA'))
    city=str(city).zfill(5) if city is not None else None
    zone=str(zone).zfill(4) if zone is not None and city else None
    semantic=office_key(office,name);jurisdiction=office_jurisdiction(semantic)
    reported=(first(row,'SG_UE','SIGLA_UE') or state).lower()
    local_city=city or (reported.zfill(5) if reported.isdigit() else None)
    unresolved=jurisdiction=='municipality' and local_city is None
    constituency='br' if jurisdiction=='national' else local_city if jurisdiction=='municipality' else state if jurisdiction=='state' else reported
    if constituency and constituency.isdigit():constituency=constituency.zfill(5)
    number_value=first(row,'NR_CANDIDATO','NUMERO_CAND') if kind=='candidate' else first(row,'NR_PARTIDO','NUMERO_PARTIDO')
    sourceid=first(row,'SQ_CANDIDATO','SEQ_CANDIDATO') if kind=='candidate' else number_value
    # The legacy key describes precisely which public fields establish identity; no name similarity is used.
    rawid=['source',sourceid] if sourceid else ['legacy',number_value,first(row,'NM_CANDIDATO','NOME_CANDIDATO') if kind=='candidate' else first(row,'NM_PARTIDO','NOME_PARTIDO'),first(row,'NR_PARTIDO','NUMERO_PARTIDO'),first(row,'SG_PARTIDO','SIGLA__PARTIDO','SIGLA_PARTIDO'),first(row,'NM_PARTIDO','NOME_PARTIDO')]
    key=[election,office,constituency,kind,*rawid]
    candidate_id=kind+':'+candidate_hash(tuple(key))
    source_record_id=None
    if unresolved:
        if not context or 'source_member' not in context or 'source_row' not in context:raise ValueError('Unresolved municipal jurisdiction requires an exact source record context')
        source_record_id=hashlib.sha256(json.dumps([context['source_url'],context['source_sha256'],context['source_member'],context['source_row'],kind],ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
        candidate_id='record:'+source_record_id
    return dict(source_record_id=source_record_id,identity_status='context_unresolved' if unresolved else 'context_resolved',reported_constituency=reported,election_id=election,grain='zone' if zone else 'municipality' if city else 'state',state=state,city_code=city,zone=zone,section=None,office=office,office_key=office_key(office,name),constituency=constituency,candidate_id=candidate_id,kind=kind,number=number_value,transit=first(row,'ST_VOTO_EM_TRANSITO'))


def candidate_record(row,lookup,source=None):
    v=identity(row,lookup,'candidate',source)
    valid=first(row,'QT_VOTOS_NOMINAIS_VALIDOS')
    raw=first(row,'QT_VOTOS_NOMINAIS','TOTAL_VOTOS')
    v['votes']=number(valid if valid is not None else raw)
    v['destination']='valid' if valid is not None else first(row,'NM_TIPO_DESTINACAO_VOTOS') or ('reported' if 'TOTAL_VOTOS' in row else None)
    c={k:v[k] for k in ['election_id','state','office','office_key','constituency','candidate_id','number']}
    c['name']=first(row,'NM_CANDIDATO','NOME_CANDIDATO')
    c.update(source_record_id=v['source_record_id'],identity_status=v['identity_status'],reported_constituency=v['reported_constituency'],short_name=first(row,'NM_URNA_CANDIDATO','NOME_URNA_CAND') or c['name'],party_number=first(row,'NR_PARTIDO','NUMERO_PARTIDO'),party=first(row,'SG_PARTIDO','SIGLA__PARTIDO','SIGLA_PARTIDO'),party_name=first(row,'NM_PARTIDO','NOME_PARTIDO'),status=first(row,'DS_SIT_TOT_TURNO','DESC_SIT_CAND_TOT'),status_code=first(row,'CD_SIT_TOT_TURNO','COD_SIT_CAND_TOT'),source_candidate_id=first(row,'SQ_CANDIDATO','SEQ_CANDIDATO'))
    for target in [v,c]:target.update(source or {})
    return v,c


def party_record(row,lookup,source=None):
    v=identity(row,lookup,'party_list',source)
    value=first(row,'QT_TOTAL_VOTOS_LEG_VALIDOS','QT_VOTOS_LEGENDA_VALIDOS','QT_VOTOS_LEGENDA','TOTAL_VOTOS_LEGENDA')
    v.update(votes=number(value),destination='valid' if 'QT_TOTAL_VOTOS_LEG_VALIDOS' in row or 'QT_VOTOS_LEGENDA_VALIDOS' in row else 'reported')
    c={k:v[k] for k in ['election_id','state','office','office_key','constituency','candidate_id','number']}
    c['name']=first(row,'NM_PARTIDO','NOME_PARTIDO')
    c.update(source_record_id=v['source_record_id'],identity_status=v['identity_status'],reported_constituency=v['reported_constituency'],short_name=first(row,'SG_PARTIDO','SIGLA_PARTIDO','SIGLA__PARTIDO') or c['name'],party_number=v['number'],party=first(row,'SG_PARTIDO','SIGLA_PARTIDO','SIGLA__PARTIDO'),party_name=c['name'],status=None,status_code=None,source_candidate_id=None)
    for target in [v,c]:target.update(source or {})
    return v,c


def legacy_rows(reader,kind):
    first_row=next(reader,None)
    if first_row is None:return
    fields=LEGACY_CANDIDATE if kind=='candidate' else LEGACY_PARTY
    if first_row[0] in ['DATA_GERACAO','DT_GERACAO']:
        fields=first_row
        for row in reader:
            if len(row)!=len(fields):raise ValueError('wrong source column count')
            record=dict(zip(fields,row));record['_source_row']=reader.line_num;yield record
    else:
        for row in itertools.chain([first_row],reader):
            if len(row)!=len(fields):raise ValueError('wrong legacy column count')
            record=dict(zip(fields,row));record['_source_row']=reader.line_num;yield record


def resources(catalog):
    seen=set()
    for d in catalog['datasets']:
        for r in d['resources']:
            u=r['url']
            if u in seen or not r.get('inScope'):continue
            if not any(p in u for p in ['votacao_candidato_uf_','votacao_candidato_munzona_','votacao_partido_uf_','votacao_partido_munzona_']):continue
            seen.add(u);yield r,('candidate' if 'votacao_candidato_' in u else 'party_list')


def build(root,output,years=None):
    cat=json.loads(pathlib.Path('data/history/catalog.json').read_text());index=json.loads(pathlib.Path('data/history/indicators.json').read_text())
    lookup=defaultdict(list)
    for e in index['elections']:
        lookup[(str(e['year']),e['description'])].append(e)
    output.mkdir(parents=True,exist_ok=True)
    handles={};writers={};counts=defaultdict(int);candidates={};sources=[];rows=0;events={};member_audits=[];identity_records={}
    def writer(table,year,state):
        key=(table,year,state)
        if key not in writers:
            name=f'{table}-{year}-{state}.csv.gz';handle=io.TextIOWrapper(gzip.GzipFile(filename='',fileobj=open(output/name,'wb'),mode='wb',compresslevel=6,mtime=0),encoding='utf8',newline='')
            handles[key]=handle;writers[key]=csv.writer(handle,lineterminator='\n')
        return key,writers[key]
    for resource,kind in resources(cat):
        u=resource['url'];sourceyear=int(re.search(r'_(\d{4})(?:_br)?\.zip$',u,re.I)[1])
        if years and sourceyear not in years:continue
        p=root/hashlib.sha256(u.encode()).hexdigest()/u.split('/')[-1]
        if not p.exists():raise FileNotFoundError(u)
        digest=hashlib.file_digest(p.open('rb'),'sha256').hexdigest();source={'source_url':u,'source_sha256':digest,'source_year':sourceyear};sources.append(source)
        start=rows
        with zipfile.ZipFile(p) as z:
            names=source_members(z.namelist())
            audit={'source_url':u,'selectedMembers':names,'selection':'national_complete_export' if any('_BRASIL.' in n.upper() for n in names) else 'disjoint_territorial_exports','coverage':{}};member_audits.append(audit)
            for name in names:
                br=name.upper().endswith('_BR.CSV')
                with z.open(name) as f:
                    reader=csv.reader(io.TextIOWrapper(f,encoding='latin1'),delimiter=';')
                    for raw in legacy_rows(reader,kind):
                        office=first(raw,'CD_CARGO','COD_CARGO')
                        coverage=(raw.get('NR_TURNO') or raw.get('NUM_TURNO') or '',raw.get('SG_UF') or raw.get('SIGLA_UF') or '',office or '')
                        ck='|'.join(coverage);audit['coverage'][ck]=audit['coverage'].get(ck,0)+1
                        v,c=(candidate_record if kind=='candidate' else party_record)(raw,lookup,{**source,'source_member':name,'source_row':raw['_source_row']})
                        if v['identity_status']=='context_unresolved':identity_records[v['candidate_id']]={k:v[k] for k in ['election_id','candidate_id','office','office_key','state','grain','source_record_id','identity_status','reported_constituency','source_url','source_sha256','source_member','source_row','source_year']}
                        if v['election_id'] not in events:
                            meta=normalize(raw,{'url':u,'id':''});events[v['election_id']]={k:meta[k] for k in ['election_id','source_election_id','year','turn','date','description','election_type']};events[v['election_id']]['election_id']=v['election_id'];events[v['election_id']]['source_year']=sourceyear
                        if v['votes'] is None:continue
                        # Zero is a published observation, not a replacement for missing data.
                        key,w=writer('election_votes',sourceyear,v['state']);w.writerow([v.get(k) for k in VOTE_FIELDS]);counts[key]+=1
                        ck=(c['election_id'],c['state'],c['candidate_id'])
                        old=candidates.get(ck)
                        if old is not None and any(old[k]!=c[k] for k in CAND_FIELDS if k not in ['source_url','source_sha256','status','status_code']):raise ValueError(f'conflicting candidate identity {ck}: {[(k,old[k],c[k]) for k in CAND_FIELDS if old[k]!=c[k]]}')
                        candidates[ck]=c;rows+=1
        print(json.dumps({'sourceYear':sourceyear,'kind':kind,'rows':rows-start,'total':rows}),flush=True)
    for c in candidates.values():
        # Parts follow the archive year of the factual source, not the source extraction timestamp.
        sourceyear=int(re.search(r'_(\d{4})(?:_br)?\.zip$',c['source_url'],re.I)[1]);state=c['state']
        key,w=writer('election_candidates',sourceyear,state);w.writerow([c.get(k) for k in CAND_FIELDS]);counts[key]+=1
    for f in handles.values():f.close()
    tables={}
    for table,fields,types in [('election_votes',VOTE_FIELDS,VOTE_TYPES),('election_candidates',CAND_FIELDS,CAND_TYPES)]:
        parts={}
        for (t,y,s),n in sorted(counts.items()):
            if t!=table:continue
            p=output/f'{t}-{y}-{s}.csv.gz';data=p.read_bytes()
            parts[f'{y}/{s}']={'url':str(p.relative_to('data')),'rows':n,'bytes':len(data),'rawBytes':len(gzip.decompress(data)),'sha256':hashlib.sha256(data).hexdigest(),'where':f"source_year = {y} and state = '{s}'"}
        tables[table]={'name':table,'columns':','.join(fields),'ddl':f'create table {table} ('+', '.join(f'{k} {t}' for k,t in zip(fields,types))+')','parts':parts}
    result={'tables':tables,'sources':sources,'rows':rows,'candidates':len(candidates),'events':list(events.values()),'memberAudits':member_audits,'identityRecords':identity_records,'identity':'Pleito, office, constituency and official candidate sequence; explicit public composite hash when sequence is absent.'}
    (output/'index.json').write_text(json.dumps(result,ensure_ascii=False,indent=1)+'\n')
    return result

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--root',type=pathlib.Path,required=True);p.add_argument('--output',type=pathlib.Path,default=pathlib.Path('data/history/facts'));p.add_argument('--years',nargs='+',type=int)
    args=p.parse_args();build(args.root,args.output,args.years)
