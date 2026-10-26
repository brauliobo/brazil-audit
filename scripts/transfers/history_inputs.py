"""Join official candidate margins to normalized turnout at their published grain."""
import csv,gzip,hashlib,io,json,zipfile
from collections import defaultdict
from pathlib import Path
from canonical import canonical_records


def load_history(year, archive_root):
    catalog=json.loads(Path('data/history/catalog.json').read_text())
    indicators=json.loads(Path('data/history/indicators.json').read_text())
    elections={e['id']:e for e in indicators['elections'] if e['year']==year}
    identities={(str(e['year']),e['id'].split(':')[1],str(e['turn']),date):e['id'] for e in elections.values() for date in e.get('dates',[])}
    units={};sources=[];records=[]
    for e in elections.values():
        for p in e['parts']:
            path=Path('data')/p['url']
            sources.append({'url':p['url'],'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
            with gzip.open(path,'rt') as f:
                for row in csv.DictReader(f):
                    if row['office'] not in ['1','3','11']:continue
                    if row.get('transit')=='S':continue
                    records.append(row)
    for row in canonical_records(records):
        key=(row['election_id'],row['state'],row['city_code'],row['zone'],row['office'])
        if key in units:raise ValueError('duplicate normalized turnout unit')
        units[key]={'meta':row,'votes':defaultdict(int),'candidates':{}}
    geographic_grain={(k[0],k[1],k[2],k[4]):bool(k[3]) for k in units}
    resources={r['url']:r for d in catalog['datasets'] if year in d.get('years',[]) for r in d['resources'] if 'votacao_candidato_' in r['url'] and ('munzona' in r['url'] or '_uf_' in r['url'])}
    for url,r in resources.items():
        path=Path(archive_root)/hashlib.sha256(url.encode()).hexdigest()/url.split('/')[-1]
        if not path.exists():continue
        sources.append({'url':url,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
        with zipfile.ZipFile(path) as z:
            names=[n for n in z.namelist() if n.lower().endswith(('.csv','.txt')) and '_BRASIL.' not in n.upper()]
            if not names:names=[n for n in z.namelist() if n.lower().endswith('.csv')]
            for name in names:
                with z.open(name) as f:
                    if year<1994:
                        for row in csv.reader(io.TextIOWrapper(f,encoding='latin1'),delimiter=';'):
                            if len(row)!=26:raise ValueError('unexpected legacy candidate schema')
                            if row[7] not in ['1','3']:continue
                            possible=[e for e in elections.values() if str(e['turn'])==row[3]]
                            if len(possible)!=1:raise ValueError('ambiguous legacy election identity')
                            key=(possible[0]['id'],row[5].lower(),'','',row[7])
                            u=units.get(key)
                            if u is None:continue
                            candidate=row[8];u['votes'][candidate]+=int(row[25])
                            u['candidates'][candidate]={'id':candidate,'label':row[11] if not row[11].startswith('#') else row[10],'sourceCandidateId':None}
                        continue
                    reader=csv.DictReader(io.TextIOWrapper(f,encoding='latin1'),delimiter=';')
                    if 'CD_CARGO' not in (reader.fieldnames or []):raise ValueError('unexpected candidate schema')
                    for row in reader:
                        office=row['CD_CARGO']
                        if office not in ['1','3','11']:continue
                        # BR is the presidential extract; UF extracts carry state/local offices.
                        br=name.upper().endswith('_BR.CSV')
                        if '_BRASIL.' not in name.upper() and (office=='1')!=br:continue
                        election=identities.get((row['ANO_ELEICAO'],row['CD_ELEICAO'],row['NR_TURNO'],row['DT_ELEICAO']))
                        if election is None:continue
                        state=row['SG_UF'].lower();city=row.get('CD_MUNICIPIO','').zfill(5)
                        zone=row.get('NR_ZONA','').zfill(4) if geographic_grain.get((election,state,city,office)) else ''
                        key=(election,state,city,zone,office)
                        u=units.get(key)
                        if u is None:continue
                        if row.get('ST_VOTO_EM_TRANSITO','N')!='N':continue
                        # Nominal VALID totals match detailed 'valid'; annulled destination votes
                        # belong to the published null margin and must not be counted twice.
                        value=row.get('QT_VOTOS_NOMINAIS_VALIDOS')
                        if value is None:
                            if row.get('NM_TIPO_DESTINACAO_VOTOS','Válido').lower() not in ['válido','valido']:continue
                            value=row.get('QT_VOTOS_NOMINAIS')
                        candidate=row['NR_CANDIDATO']
                        u['votes'][candidate]+=int(value)
                        u['candidates'][candidate]={'id':candidate,'label':row.get('NM_URNA_CANDIDATO') or row['NM_CANDIDATO'],'sourceCandidateId':row.get('SQ_CANDIDATO')}
    return elections,units,sources


def aggregate_units(units,grain='state'):
    grouped={}
    for key,u in units.items():
        m=u['meta'];office=int(m['office'])
        geo=(m['state'],m['city_code'] if grain!='state' else '',m['zone'] if grain=='zone' else '')
        k=(m['election_id'],office,*geo)
        a=grouped.setdefault(k,{'eligible':0,'installed':0,'present':0,'absent':0,'votes':defaultdict(int),'candidates':{},'meta':m})
        for field in ['eligible','installed','present','absent']:
            if m.get(field) in [None,''] or a[field] is None:a[field]=None
            else:a[field]+=int(m[field])
        if m['blank'] in [None,''] or m['null'] in [None,'']:a['incomplete']=True
        else:
            a['votes']['blank']+=int(m['blank']);a['votes']['null']+=int(m['null'])
        if m.get('null_technical') not in [None,'']:a['votes']['null']+=int(m['null_technical'])
        for category in ['annulled','annulled_subjudice','annulled_separate']:
            if m.get(category) not in [None,'']:a['votes'][category]+=int(m[category])
        for candidate,count in u['votes'].items():a['votes'][candidate]+=count
        a['candidates'].update(u['candidates'])
    return grouped
