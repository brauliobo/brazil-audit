#!/usr/bin/env python3
"""Normalize archived lists, declared vacancies and historical candidate-list links."""
import argparse
import csv
import gzip
import hashlib
import io
import json
import zipfile
from collections import defaultdict
from itertools import chain
from pathlib import Path

from candidate_facts import clean,office_jurisdiction
from normalize_history import number,office_key
from source_members import source_members
from tse_archive import read_json,write_json,sha256

COMMON=['source_context_id','election_id','source_year','turn','description','election_code','election_date','election_type','inauguration_date',
    'office','office_key','office_name','state','constituency','constituency_name','constituency_grain','office_constituency_grain',
    'binding_kind','session_keys','generated_date','generated_time','source_url','source_sha256','source_member','source_record_id','provenance']
LIST=['list_id','list_kind','party_number','party','party_name','coalition_acronym','coalition_name','composition','source_coalition_id',
    'federation_number','federation_name','federation_acronym','federation_composition','list_status','list_status_code','destination']
LINK=['candidate_id','source_candidate_id','candidate_number','name','short_name','party_number','party','party_name','composition','list_kind','candidate_status','candidate_status_code']
EXTRA={'election_lists':LIST,'election_declared_seats':['seats','metric_sentinels'],'candidate_list_links':LINK}
LEGACY_LIST=['DT_GERACAO','HH_GERACAO','ANO_ELEICAO','NR_TURNO','DS_ELEICAO','SG_UF','SG_UE','NM_UE','CD_CARGO','DS_CARGO',
    'TP_AGREMIACAO','NR_PARTIDO','SG_PARTIDO','NM_PARTIDO','SG_COLIGACAO','NM_COLIGACAO','DS_COMPOSICAO_COLIGACAO','SQ_COLIGACAO']
LEGACY_SEATS=['DT_GERACAO','HH_GERACAO','ANO_ELEICAO','DS_ELEICAO','SG_UF','SG_UE','NM_UE','CD_CARGO','DS_CARGO','QT_VAGA']


def get(row,*names):
    for name in names:
        value=row.get(name)
        value=value.strip() if isinstance(value,str) else value
        if clean(value) is not None:return value
    return None


def kind(url):
    if '/consulta_vagas/' in url:return 'election_declared_seats'
    if 'candidato_legenda_' in url:return 'candidate_list_links'
    return 'election_lists'


def source_rows(path,table):
    """Headerless historical layouts are explicit, never guessed from quantities."""
    with zipfile.ZipFile(path) as archive:
        for member in source_members(archive.namelist()):
            with archive.open(member) as binary:
                reader=csv.reader(io.TextIOWrapper(binary,encoding='latin1',newline=''),delimiter=';')
                first=next(reader,None)
                if first is None:continue
                if 'ANO_ELEICAO' in first:
                    fields=first;pending=[]
                else:
                    fields=LEGACY_SEATS if table=='election_declared_seats' else LEGACY_LIST
                    if table=='candidate_list_links' or len(first) not in ([10] if table=='election_declared_seats' else [17,18]):
                        raise ValueError(f'unsupported historical nomination layout: {member} / {len(first)}')
                    if len(first)==17:fields=fields[:17]
                    pending=[first]
                for line,values in enumerate(chain(pending,reader),start=1 if pending else 2):
                    if len(values)!=len(fields):raise ValueError(f'nomination field count differs: {member}:{line}')
                    yield member,line,dict(zip(fields,values))


class ElectionBindings:
    def __init__(self,registry):
        self.events=defaultdict(list);self.references=defaultdict(set)
        for event in registry['events']:
            for year in event['sourceDatasetYears']:
                for code in event['sourceElectionIds']:
                    for date in event['dates']:
                        for office in event['offices']:self.events[(year,code,date,office['key'])].append(event)
        for session in registry['sessions']:
            for year in session['sourceYears']:
                for office in session['offices']:
                    self.references[(year,office['key'],None)].add(session['key'])
                    self.references[(year,office['key'],session['turn'])].add(session['key'])


def context(row,bindings):
    year=number(get(row,'ANO_ELEICAO'));turn=number(get(row,'NR_TURNO','NUM_TURNO'))
    description=get(row,'DS_ELEICAO','DESC_ELEICAO','DESCRICAO_ELEICAO') or ''
    code=get(row,'CD_CARGO','COD_CARGO','CODIGO_CARGO') or '';name=get(row,'DS_CARGO','DESC_CARGO','DESCRICAO_CARGO') or ''
    office=office_key(code,name);state=(get(row,'SG_UF','SIGLA_UF') or '').lower()
    ue=get(row,'SG_UE','SIGLA_UE');ue=ue.lower() if ue else None
    if ue and ue.isdigit():ue=ue.zfill(5)
    election=get(row,'CD_ELEICAO');date=get(row,'DT_ELEICAO')
    iso='-'.join(reversed(date.split('/'))) if date else None
    exact=[e for e in bindings.events.get((year,election,date,office),[]) if turn is None or e['turn']==turn]
    event=exact[0] if len(exact)==1 else None
    sessions=[event['session_key']] if event else sorted(bindings.references[(year,office,turn)])
    identity=[year,turn,description,election,iso]
    return dict(source_context_id='nomination:'+hashlib.sha256(json.dumps(identity,ensure_ascii=False).encode()).hexdigest()[:24],
        election_id=event['id'] if event else None,source_year=year,turn=turn,description=description,election_code=election,election_date=iso,
        election_type=get(row,'NM_TIPO_ELEICAO','DS_TIPO_ELEICAO'),inauguration_date=get(row,'DT_POSSE'),office=code,office_key=office,office_name=name,
        state=state,constituency=ue,constituency_name=get(row,'NM_UE','NOME_UE','NOME_UF'),
        constituency_grain='municipality' if ue and ue.isdigit() else 'national' if ue=='br' else 'state' if ue else 'unknown',
        office_constituency_grain=office_jurisdiction(office),binding_kind='exact-event' if event else 'source-context',
        session_keys=json.dumps(sessions,separators=(',',':')),generated_date=get(row,'DT_GERACAO','DATA_GERACAO'),generated_time=get(row,'HH_GERACAO','HORA_GERACAO'))


def normalize(row,table,bindings):
    result=context(row,bindings)
    party=dict(party_number=get(row,'NR_PARTIDO','NUMERO_PARTIDO','NUM_PARTIDO'),party=get(row,'SG_PARTIDO','SIGLA_PARTIDO','SIGLA__PARTIDO'),
        party_name=get(row,'NM_PARTIDO','NOME_PARTIDO','NOME_LEGENDA'),composition=get(row,'DS_COMPOSICAO_COLIGACAO','COMPOSICAO_LEGENDA','COMPOSICAO_COLIGACAO'),
        list_kind=get(row,'TP_AGREMIACAO','TIPO_LEGENDA','DESC_TIPO_PARTIDO'))
    if table=='election_declared_seats':
        value=next((row[k] for k in ['QT_VAGA','QT_VAGAS','QTDE_VAGAS'] if k in row),None)
        result.update(seats=number(value),metric_sentinels=json.dumps({'seats':value} if value not in [None,''] and number(value) is None else {},separators=(',',':')))
    elif table=='candidate_list_links':
        result.update(party,candidate_id=None,source_candidate_id=get(row,'SQ_CANDIDATO','SEQ_CANDIDATO'),candidate_number=get(row,'NR_CANDIDATO','NUMERO_CAND'),
            name=get(row,'NM_CANDIDATO','NOME_CANDIDATO'),short_name=get(row,'NM_URNA_CANDIDATO','NOME_URNA_CANDIDATO','NOME_URNA_CAND'),
            candidate_status=get(row,'DS_SITUACAO_CANDIDATURA','DESC_SIT_CANDIDATO','DESC_SIT_CAND'),candidate_status_code=get(row,'CD_SITUACAO_CANDIDATURA','CODIGO_SIT_CANDIDATO','COD_SIT_CAND'))
    else:
        result.update(party,coalition_acronym=get(row,'SG_COLIGACAO','SIGLA_COLIGACAO'),coalition_name=get(row,'NM_COLIGACAO','NOME_COLIGACAO'),
            source_coalition_id=get(row,'SQ_COLIGACAO','SEQ_COLIGACAO','SEQUENCIAL_COLIGACAO'),
            federation_number=get(row,'NR_FEDERACAO'),federation_name=get(row,'NM_FEDERACAO'),federation_acronym=get(row,'SG_FEDERACAO'),
            federation_composition=get(row,'DS_COMPOSICAO_FEDERACAO'),list_status=get(row,'DS_SITUACAO'),list_status_code=get(row,'CD_SITUACAO_LEGENDA'),destination=get(row,'NM_TIPO_DESTINACAO_VOTOS'))
        identity={k:v for k,v in result.items() if k not in ['generated_date','generated_time','session_keys','binding_kind','election_id']}
        result['list_id']='list:'+hashlib.sha256(json.dumps(identity,ensure_ascii=False,sort_keys=True).encode()).hexdigest()[:24]
    return result


def table_definition(name,parts):
    fields=COMMON+EXTRA[name];integers={'source_year','turn','seats'};objects={'session_keys','provenance','metric_sentinels'}
    return dict(name=name,columns=','.join(fields),ddl=f'create table {name} ('+', '.join(f'{k} '+('bigint' if k in integers else 'jsonb' if k in objects else 'text') for k in fields)+')',parts=parts,
        semantics='Reported list/vacancy context. NULL election_id is not an inferred election; session_keys are explicitly labelled source-year references. Declared vacancies are not observed elected outcomes.')


def build(root,data_dir,output_dir=None):
    output_dir=output_dir or root/'normalized-nominations'
    registry=read_json(data_dir/'elections.json');catalog=read_json(data_dir/'history/catalog.json')
    bindings=ElectionBindings(registry)
    resources={r['url']:r for d in catalog['datasets'] if d.get('inScope') for r in d['resources'] if r.get('inScope')
        and any(x in r['url'] for x in ['/consulta_legendas/','/consulta_vagas/','/consulta_coligacao/'])}
    grouped=defaultdict(dict);audits=[];contexts={}
    for url,resource in sorted(resources.items()):
        path=root/'downloads'/hashlib.sha256(url.encode()).hexdigest()/url.split('/')[-1];digest=sha256(path)
        if resource['sha256']!=digest:raise ValueError('nomination source digest differs from archived provenance')
        table=kind(url);count=0;members=set()
        for member,line,raw in source_rows(path,table):
            row=normalize(raw,table,bindings);members.add(member);count+=1
            row.update(source_url=url,source_sha256=digest,source_member=member)
            # Equal source facts can be repeated in national and UF members;
            # preserve their provenance once, never add repeated vacancies.
            identity={k:v for k,v in row.items() if k not in ['source_member','generated_date','generated_time']}
            rid=hashlib.sha256(json.dumps(identity,ensure_ascii=False,sort_keys=True).encode()).hexdigest()
            key=(table,row['source_year'],row['state']);existing=grouped[key].get(rid)
            provenance=dict(member=member,line=line,generated_date=row['generated_date'],generated_time=row['generated_time'])
            if existing:existing['_provenance'].append(provenance)
            else:row.update(source_record_id=rid,_provenance=[provenance]);grouped[key][rid]=row
            contexts[row['source_context_id']]=dict(id=row['source_context_id'],year=row['source_year'],turn=row['turn'],description=row['description'],election_id=row['election_id'],binding_kind=row['binding_kind'])
        audits.append(dict(source_url=url,source_sha256=digest,table=table,selectedMembers=sorted(members),rows=count))
        print(json.dumps(dict(source=url,rows=count,table=table)),flush=True)
    tables={name:table_definition(name,{}) for name in EXTRA}
    for (name,year,state),records in sorted(grouped.items()):
        fields=COMMON+EXTRA[name];rows=list(records.values())
        for row in rows:
            provenance=row.pop('_provenance')
            for field in ['generated_date','generated_time']:
                values={p[field] for p in provenance};row[field]=values.pop() if len(values)==1 else None
            row['provenance']=json.dumps(provenance,ensure_ascii=False,separators=(',',':'))
        text=io.StringIO(newline='');writer=csv.DictWriter(text,fields,lineterminator='\n');writer.writerows(sorted(rows,key=lambda r:r['source_record_id']))
        raw=text.getvalue().encode();body=gzip.compress(raw,mtime=0);relative=f'nominations/{name}/{year}/{state or "unknown"}.csv.gz';path=output_dir/relative
        path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(body)
        sessions=sorted({s for row in rows for s in json.loads(row['session_keys'])})
        escaped=state.replace("'","''")
        tables[name]['parts'][f'{year}/{state}']=dict(url=relative,rows=len(rows),bytes=len(body),rawBytes=len(raw),sha256=hashlib.sha256(body).hexdigest(),
            where=f"source_year = {year} and state = '{escaped}'",sourceYears=[year],states=[state],officeKeys=sorted({r['office_key'] for r in rows}),sessionKeys=sessions,
            electionIds=sorted({r['election_id'] for r in rows if r['election_id']}),grains=sorted({r['constituency_grain'] for r in rows}),role=name,
            sourceContexts=sorted({r['source_context_id'] for r in rows}))
    index=dict(version=1,tables=tables,sources=audits,contexts=list(contexts.values()),scope='Source-reported lists, parties, coalitions, federations, vacancies and candidate-list relationships; not inferred election results.')
    write_json(output_dir/'nominations/index.json',index)
    print(json.dumps(dict(sources=len(audits),rows={k:sum(p['rows'] for p in t['parts'].values()) for k,t in tables.items()})),flush=True)
    return index


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--root',type=Path,default=Path('.cache/tse-archive'));p.add_argument('--data-dir',type=Path,default=Path('data'));p.add_argument('--output-dir',type=Path);args=p.parse_args();build(args.root,args.data_dir,args.output_dir)
