"""Current official TSE code -> IBGE municipality -> immediate region mapping.

Historical observations use this explicitly dated regional partition, not an
assertion that the historical regional boundaries or electorate were unchanged.
"""
import csv,gzip,hashlib,json
from collections import defaultdict
from pathlib import Path

IBGE_URL='https://servicodados.ibge.gov.br/api/v1/localidades/municipios'
TSE_URL='https://resultados.tse.jus.br/oficial/ele2026/6258/config/mun-e006258-cm.json'


def mapping():
    tse_path=Path('.cache/turnout-2026-2-municipalities.json')
    ibge_path=Path('.cache/transfers-ibge-municipalities.json')
    tse=json.loads(tse_path.read_text());ibge=json.loads(ibge_path.read_text())
    by_ibge={str(m['id']):m for m in ibge}
    direct={};names={};unmapped=[]
    with gzip.open('data/mun_map.csv.gz','rt') as f:
        known={(r[0],r[3]):r[2] for r in csv.reader(f) if r[2] and r[3]}
    for state in tse['abr']:
        uf=state['cd']
        if uf=='zz':continue
        for city in state['mu']:
            code=city['cd'];cdi=city.get('cdi')
            if not cdi or cdi not in by_ibge:
                unmapped.append({'state':uf,'tse':code,'ibge':cdi});continue
            if (uf,code) in known and known[(uf,code)]!=cdi:raise ValueError('conflicting TSE/IBGE code mapping')
            m=by_ibge[cdi];region=m['regiao-imediata']
            region_uf=region['regiao-intermediaria']['UF']['sigla'].lower()
            if region_uf!=uf:raise ValueError('cross-state region mapping')
            key=(uf,code)
            if key in direct:raise ValueError('duplicate TSE municipality identity')
            direct[key]={'state':uf,'tse':code,'ibge':cdi,'region':str(region['id']),'regionName':region['nome']}
            names[(uf,city['nm'])]=code
    sources=[{'url':TSE_URL,'sha256':hashlib.sha256(tse_path.read_bytes()).hexdigest()},
             {'url':IBGE_URL,'sha256':hashlib.sha256(ibge_path.read_bytes()).hexdigest()},
             {'url':'https://github.com/brauliobo/brazil-audit/blob/main/data/mun_map.csv.gz','sha256':hashlib.sha256(Path('data/mun_map.csv.gz').read_bytes()).hexdigest()}]
    public={'version':1,'partition':'IBGE immediate regions','referenceYear':2026,'sources':sources,'municipalities':list(direct.values()),'unmapped':unmapped}
    Path('data/transfers/regions.json').write_text(json.dumps(public,ensure_ascii=False,separators=(',',':'))+'\n')
    return direct,names,sources


def group_regions(units,crosswalk):
    groups={};unmapped=[]
    for key,u in units.items():
        uf,code=key[:2]
        mapped=crosswalk.get((uf,code))
        if mapped is None:
            unmapped.append({'key':list(key),'electorate':u.get('eligible'),'reason':'unmapped_historical_code' if code else 'source_grain_too_coarse'});continue
        k=(uf,mapped['region'])
        a=groups.setdefault(k,{'eligible':0,'installed':0,'present':0,'absent':0,'votes':defaultdict(int),'candidates':{},'municipalities':[]})
        a['municipalities'].append(code)
        for field in ['eligible','installed','present','absent']:
            if u.get(field) is None or a[field] is None:a[field]=None
            else:a[field]+=u[field]
        for candidate,count in u['votes'].items():a['votes'][candidate]+=count
        a['candidates'].update(u['candidates'])
        if u.get('incomplete'):a['incomplete']=True
    return groups,unmapped
