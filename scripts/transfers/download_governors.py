"""Download verified 2026 governor scopes with bounded concurrency.

A 404 is recorded as an unpublished scope, never replaced with fabricated data.
Other errors stop the run; completed exact snapshots remain reusable.
"""
import argparse,json,urllib.request,urllib.error
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path


def main():
    p=argparse.ArgumentParser();p.add_argument('--states',nargs='+',required=True);args=p.parse_args()
    config=json.loads(Path('.cache/turnout-2026-2-municipalities.json').read_text())
    targets=[]
    for state in config['abr']:
        uf=state['cd']
        if uf not in args.states:continue
        scopes=[('',None,'uf')]+[(city['cd'],None,'city') for city in state['mu']]+[(city['cd'],zone,'zone') for city in state['mu'] for zone in city['z']]
        for turn,event in [(1,6259),(2,6260)]:
            for code,zone,scope in scopes:
                suffix=f'{uf}{code}'+(f'-z{zone}' if zone else '')
                name=f'{suffix}-c0003-e{event:06d}-u.json'
                targets.append({'turn':turn,'event':event,'state':uf,'code':code,'zone':zone,'scope':scope,
                                'url':f'https://resultados.tse.jus.br/oficial/ele2026/{event}/dados/{uf}/{name}',
                                'cache':f'transfers-2026-{turn}-governor-{suffix}.json'})
    found=set(t['state'] for t in targets)
    if found!=set(args.states):raise ValueError('state not in official municipality registry')
    def fetch(t):
        path=Path('.cache')/t['cache']
        if not path.exists():
            try:
                with urllib.request.urlopen(t['url'],timeout=60) as response:body=response.read()
            except urllib.error.HTTPError as error:
                if error.code==404:return {**t,'status':'not_published'}
                raise
            data=json.loads(body)
            if int(data['ele'])!=t['event'] or int(data['t'])!=t['turn']:raise ValueError('wrong election response')
            path.write_bytes(body)
        return {**t,'status':'available'}
    completed=[]
    with ThreadPoolExecutor(max_workers=4) as executor:
        for result in executor.map(fetch,targets):
            completed.append(result)
            if len(completed)%200==0:print(len(completed),len(targets),flush=True)
    Path('.cache/transfers-governor-availability.json').write_text(json.dumps(completed,ensure_ascii=False,indent=2)+'\n')
    print('completed',len(completed),'available',sum(t['status']=='available' for t in completed),flush=True)

if __name__=='__main__':main()
