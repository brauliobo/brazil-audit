#!/usr/bin/env python3
"""Public analytical candidate attributes only; no personal identifiers or exact birth dates are emitted."""
import argparse,csv,datetime,gzip,hashlib,io,json,pathlib,re,zipfile
from candidate_facts import clean,first,identity,legacy_rows,election_identity,resources,gzip_text,source_members,candidate_record
from normalize_history import normalize
from collections import defaultdict
FIELDS=['election_id','state','office','office_key','constituency','candidate_id','number','name','short_name','party_number','party','party_name','source_candidate_id','gender','race','education','occupation','age_band','status','status_code','candidacy_status','source_url','source_sha256','source_year']

def attribute_record(raw,lookup,source):
    _,key=candidate_record(raw,lookup,source)
    result={k:key[k] for k in FIELDS if k in key}
    age=None
    birth=first(raw,'DT_NASCIMENTO');date=first(raw,'DT_ELEICAO')
    if birth and date:
        try:
            born=datetime.datetime.strptime(birth,'%d/%m/%Y').date();election=datetime.datetime.strptime(date,'%d/%m/%Y').date()
            value=election.year-born.year-((election.month,election.day)<(born.month,born.day))
            if 0<=value<=120:age=value
        except ValueError:pass # Official missing/malformed birth values cannot establish an analytical age band.
    band=None if age is None else '<18' if age<18 else '18–24' if age<25 else '25–34' if age<35 else '35–44' if age<45 else '45–54' if age<55 else '55–64' if age<65 else '65+'
    result.update(gender=first(raw,'DS_GENERO'),race=first(raw,'DS_COR_RACA'),education=first(raw,'DS_GRAU_INSTRUCAO'),occupation=first(raw,'DS_OCUPACAO'),age_band=band,status=first(raw,'DS_SIT_TOT_TURNO'),status_code=first(raw,'CD_SIT_TOT_TURNO'),candidacy_status=first(raw,'DS_SITUACAO_CANDIDATURA'),**source)
    return result

def build(root,output):
    cat=json.load(open('data/history/catalog.json'));ind=json.load(open('data/history/indicators.json'));lookup=defaultdict(list)
    for e in ind['elections']:lookup[(str(e['year']),e['description'])].append(e)
    output.mkdir(parents=True,exist_ok=True);rows={};parts={};sources=[];events={}
    resources={r['url']:r for d in cat['datasets'] for r in d['resources'] if '/consulta_cand/consulta_cand_' in r['url'] and r.get('inScope')}
    for url,r in resources.items():
        year=int(re.search(r'_(\d{4})\.zip$',url)[1]);p=root/hashlib.sha256(url.encode()).hexdigest()/url.split('/')[-1]
        if not p.exists():raise FileNotFoundError(url)
        with p.open('rb') as f:digest=hashlib.file_digest(f,'sha256').hexdigest()
        source={'source_url':url,'source_sha256':digest,'source_year':year};sources.append(source);observations={}
        with zipfile.ZipFile(p) as z:
            names=source_members(z.namelist())
            for name in names:
                br=name.upper().endswith('_BR.CSV')
                with z.open(name) as f:
                    for raw in csv.DictReader(io.TextIOWrapper(f,encoding='latin1'),delimiter=';'):
                        if 'CD_CARGO' not in raw:raise ValueError('unexpected candidate attribute schema')
                        meta=normalize(raw,{'url':url,'id':''});eid=election_identity(raw,lookup)
                        events[eid]={k:meta[k] for k in ['election_id','source_election_id','year','turn','date','description','election_type']};events[eid]['election_id']=eid;events[eid]['source_year']=year
                        row=attribute_record(raw,lookup,source);key=(row['election_id'],row['state'],row['candidate_id'])
                        if key in observations and observations[key]!=row:raise ValueError('conflicting candidate attributes')
                        observations[key]=row
        grouped=defaultdict(list)
        for row in observations.values():grouped[row['state']].append(row)
        for state,records in grouped.items():
            path=output/f'candidate_attributes-{year}-{state}.csv.gz'
            with gzip_text(path) as f:
                w=csv.writer(f,lineterminator='\n');w.writerows([[r.get(k) for k in FIELDS] for r in records])
            data=path.read_bytes();parts[f'{year}/{state}']={'url':str(path.relative_to('data')),'rows':len(records),'bytes':len(data),'rawBytes':len(gzip.decompress(data)),'sha256':hashlib.sha256(data).hexdigest(),'where':f"source_year = {year} and state = '{state}'"}
        print(json.dumps({'sourceYear':year,'attributes':len(observations)}),flush=True)
    table={'name':'candidate_attributes','columns':','.join(FIELDS),'ddl':'create table candidate_attributes ('+', '.join(k+(' int' if k=='source_year' else ' text') for k in FIELDS)+')','parts':parts}
    result={'tables':{'candidate_attributes':table},'sources':sources,'events':list(events.values())};(output/'index.json').write_text(json.dumps(result,ensure_ascii=False,indent=1)+'\n');return result
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--root',type=pathlib.Path,required=True);p.add_argument('--output',type=pathlib.Path,default=pathlib.Path('data/history/attributes'));a=p.parse_args();build(a.root,a.output)
