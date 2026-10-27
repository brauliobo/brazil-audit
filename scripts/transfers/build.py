"""Build source-traceable observed margins, feasible bounds and fit inputs."""
import argparse,gzip,hashlib,json,pickle,re
from contests import election_pairs
from collections import defaultdict
from pathlib import Path
import numpy as np
from history_inputs import load_history,aggregate_units
from prepare import margins
from engine import feasible_bounds

METHOD={'id':'exact-hierarchical-dirichlet-multinomial','interval':'posterior-95',
        'populationScenario':'minimum-registration-balance','version':1,
        'references':['https://doi.org/10.1111/1467-9574.00162','https://doi.org/10.1214/09-BA415'],
        'assumptions':['Individual vote transitions are unobserved.','Territorial administrative balances assume minimum local turnover; gross mobility is unknown.'],
        'seed':20261025}


def emit_contest(ident,year,office,state,city,first,second,sources,description,grain):
    prepared=margins(first,second)
    x,y=prepared.pop('x'),prepared.pop('y')
    status='inconclusive';reason='insufficient_units'
    if len(x)==0:status='unavailable';reason='no_matched_units'
    elif x.shape[1]==0 or y.shape[1]==0:reason='missing_candidate_data'
    elif len(x)>x.shape[1]:
        if np.linalg.matrix_rank(x)<x.shape[1]:reason='rank_deficient'
        else:status='pending';reason='model_pending'
    lower,upper=feasible_bounds(x,y) if len(x) else (np.empty((0,0)),np.empty((0,0)))
    cells=[{'from':a['id'],'to':b['id'],'estimate':None,'rowShare':None,'low':None,'high':None,
            'boundLow':int(lower[i,j]),'boundHigh':int(upper[i,j])}
           for i,a in enumerate(prepared['from']) for j,b in enumerate(prepared['to'])]
    strict=margins(first,second,'strict-compatible-totals')
    registration_sensitivity=[]
    for rate in [.001,.01]:
        scenario=margins(first,second,turnover=rate)
        low,high=feasible_bounds(scenario['x'],scenario['y']) if len(scenario['x']) else (np.empty((0,0)),np.empty((0,0)))
        registration_sensitivity.append({'assumedGrossTurnoverRate':rate,'observed':False,'registration':scenario['registration'],
                                        'from':scenario['from'],'to':scenario['to'],'boundLow':low.tolist(),'boundHigh':high.tolist()})
    output={'id':ident,'year':year,'office':office,'state':state,'city':city,'description':description,
            'status':status,'reason':reason,'method':{**METHOD,'grain':grain},'from':prepared['from'],'to':prepared['to'],
            'cells':cells,'coverage':prepared['coverage'],'observed':{'registration':prepared['registration']},'registrationSensitivity':registration_sensitivity,
            'models':[{'id':'strict-compatible-totals','status':'observed','coverage':strict['coverage'],'registration':strict['registration']}],
            'diagnostics':{'unitKeys':prepared['unitKeys']},'sourceHashes':sources}
    root=Path('data/transfers');root.mkdir(exist_ok=True)
    path=root/f'{ident}.json';path.write_text(json.dumps(output,ensure_ascii=False,separators=(',',':'))+'\n')
    cache=Path('.cache/transfers-inputs');cache.mkdir(exist_ok=True)
    np.savez_compressed(cache/f'{ident}.npz',x=x,y=y)
    return {'id':ident,'year':year,'office':office,'state':state,'city':city,'description':description,
            'status':status,'reason':reason,'grain':grain,'url':f'transfers/{ident}.json','coverage':output['coverage'],
            'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'bytes':path.stat().st_size}


def unavailable_region(ident,year,state,first,second,unmapped,sources,description):
    def total(units):
        values=[u.get('eligible') for u in units.values()]
        return sum(values) if all(n is not None for n in values) else None
    reason='source_grain_too_coarse' if all(q.get('reason')=='source_grain_too_coarse' for q in unmapped) else 'unmapped_historical_code'
    coverage={'units':0,'eligibleUnits':len(set(first)|set(second)),'electorate':0,
              'electorateTotal':total(first),'share':0 if total(first) else None,
              'excluded':[{'reason':reason,'units':len(unmapped),'electorate':None}]}
    output={'id':ident,'year':year,'office':3,'state':state,'city':'','description':description,
            'status':'unavailable','reason':reason,'method':{**METHOD,'grain':'ibge-immediate-2026'},
            'from':[],'to':[],'cells':[],'coverage':coverage,'observed':{'registration':{'first':total(first),'second':total(second),'augmentedPopulation':None}},
            'diagnostics':{'unmapped':unmapped},'sourceHashes':sources}
    path=Path('data/transfers')/f'{ident}.json';path.write_text(json.dumps(output,ensure_ascii=False,separators=(',',':'))+'\n')
    return {k:output[k] for k in ['id','year','office','state','city','description','status','reason','coverage']}|{'grain':'ibge-immediate-2026','url':f'transfers/{ident}.json','sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'bytes':path.stat().st_size}


def history_data(year,archive_root):
    cache=Path(f'.cache/transfers-history-{year}.pickle')
    index=json.loads(Path('data/history/indicators.json').read_text())
    versions=[e for e in index['elections'] if e['year']==year]
    fingerprint=hashlib.sha256((json.dumps(versions,sort_keys=True)+Path(__file__).with_name('history_inputs.py').read_text()).encode()).hexdigest()
    stamp=cache.with_suffix('.fingerprint')
    if cache.exists() and stamp.exists() and stamp.read_text()==fingerprint:
        elections,units,sources=pickle.loads(cache.read_bytes())
    else:
        elections,units,sources=load_history(year,archive_root)
        cache.write_bytes(pickle.dumps((elections,units,sources)));stamp.write_text(fingerprint)
    return elections,units,sources


def build_history(year,archive_root,regional=False):
    elections,units,sources=history_data(year,archive_root)
    groups={second:{1:first,2:second} for first,second in election_pairs(elections)}
    outputs=[]
    for pairkey,pair in groups.items():
        if set(pair)!={1,2}:continue
        for office in ([3] if regional else [1,3,11]):
            grain={1:'state',3:'city',11:'zone'}[office]
            selected={k:v for k,v in units.items() if k[0] in pair.values() and k[4]==str(office)}
            if office==3 and selected and all(not k[2] for k in selected):grain='state'
            aggregated=aggregate_units(selected,grain)
            targets=sorted(set((k[2] if office!=1 else 'br',k[3] if office==11 else '') for k in aggregated if k[0]==pair[2]))
            for state,city in targets:
                rounds={}
                for turn in [1,2]:
                    rounds[turn]={tuple(k[2:]):v for k,v in aggregated.items() if k[0]==pair[turn] and (office==1 or k[2]==state) and (office!=11 or k[3]==city)}
                ident=f'{year}-{pair[1].split(":")[1]}-{pair[2].split(":")[1]}-{office}-{state}'+(f'-{city}' if city else '')
                if regional:
                    from regions import mapping,group_regions
                    crosswalk,_,mapping_sources=mapping()
                    grouped={};unmapped=[]
                    for turn in [1,2]:
                        grouped[turn],missing=group_regions(rounds[turn],crosswalk);unmapped+=missing
                    if unmapped:
                        # A regional model requires an exact mapping for the
                        # complete dispute; never discard unknown municipalities.
                        outputs.append(unavailable_region(ident+'-ibge-immediate',year,state,rounds[1],rounds[2],unmapped,sources+mapping_sources,elections[pair[1]]['description']))
                        continue
                    ident+='-ibge-immediate'
                    outputs.append(emit_contest(ident,year,office,state,city,grouped[1],grouped[2],sources+mapping_sources,elections[pair[1]]['description'],'ibge-immediate-2026'))
                else:
                    outputs.append(emit_contest(ident,year,office,state,city,rounds[1],rounds[2],sources,elections[pair[1]]['description'],grain))
    return outputs


from official_sources import official_unit,governors_2026


def build_2026():
    first={};second={};sources=[]
    config=json.loads(Path('.cache/turnout-2026-2-municipalities.json').read_text())
    for state in config['abr']:
        uf=state['cd']
        for turn,prefix,event,dest in [(1,'transfers-2026-1-',6257,first),(2,'turnout-2026-2-',6258,second)]:
            path=Path(f'.cache/{prefix}{uf}.json');data=json.loads(path.read_text())
            if int(data['ele'])!=event or int(data['t'])!=turn or data['carg'][0]['cd']!='1' or data['tpabr']!='uf':raise ValueError('wrong presidential source profile')
            dest[(uf,)]=official_unit(data)
            sources.append({'url':f'https://resultados.tse.jus.br/oficial/ele2026/{event}/dados/{uf}/{uf}-c0001-e{event:06d}-u.json','sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
    output=[emit_contest('2026-6257-6258-1-br',2026,1,'br','',first,second,sources,'Eleição presidencial2026','state')]
    units,governor_sources=governors_2026()
    states=sorted(set(k[1] for k in units))
    for state in states:
        for grain in ['city','zone']:
            converted={}
            for turn in [1,2]:
                converted[turn]={(k[1],k[2],k[3]):u for k,u in units.items() if k[0]==turn and k[1]==state and k[2] and bool(k[3])==(grain=='zone')}
            suffix='-zone' if grain=='zone' else ''
            output.append(emit_contest(f'2026-6259-6260-3-{state}{suffix}',2026,3,state,'',converted[1],converted[2],[s for s in governor_sources if f'/dados/{state}/' in s['url']],'Eleição governador2026',grain))
    return output


def build_year(year,archive_root):
    # One source profile owns each annual extraction. 2026 uses office-specific
    # official JSONs; its overlapping normalized rollups are not emitted again.
    return build_2026() if year==2026 else build_history(year,archive_root)


def main():
    p=argparse.ArgumentParser();p.add_argument('--archive-root',required=True);p.add_argument('--years',nargs='*',type=int)
    args=p.parse_args();index=json.loads(Path('data/history/indicators.json').read_text())
    years=args.years or sorted(set(e['year'] for e in index['elections'] if e['turn']==2)|{2026})
    contests=[]
    for year in years:
        output=build_year(year,args.archive_root);contests.extend(output);print(year,len(output),flush=True)
    # Explicit dataset applicability, including constitutional/legislative and
    # single-round historical elections; these contain no fabricated margins.
    paired_years=set(c['year'] for c in contests)
    for year in sorted(set(e['year'] for e in index['elections'])-paired_years):
        ident=f'{year}-not-applicable'
        payload={'id':ident,'year':year,'office':0,'state':'br','description':f'Eleições {year}',
                 'status':'not_applicable','reason':'no_second_round','method':METHOD,'from':[],'to':[],'cells':[],
                 'coverage':{'units':0,'eligibleUnits':0,'electorate':0,'electorateTotal':None,'share':None,'excluded':[]},
                 'sourceElectionIds':[e['id'] for e in index['elections'] if e['year']==year]}
        path=Path('data/transfers')/f'{ident}.json';path.write_text(json.dumps(payload,ensure_ascii=False,separators=(',',':'))+'\n')
        contests.append({k:payload[k] for k in ['id','year','office','state','description','status','reason','coverage']}|{'url':f'transfers/{ident}.json','sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'bytes':path.stat().st_size})
    Path('data/transfers/index.json').write_text(json.dumps({'version':1,'method':METHOD,'contests':contests},ensure_ascii=False,indent=2)+'\n')

if __name__=='__main__':main()
