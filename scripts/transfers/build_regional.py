"""Add a parallel official-IBGE regional resolution; retain municipal inputs."""
import argparse,fcntl,json
from pathlib import Path
from build import build_history,emit_contest,unavailable_region
from regions import mapping,group_regions
from official_sources import governors_2026


def build_2026_regions():
    crosswalk,_,sources=mapping()
    units,official_sources=governors_2026()
    output=[]
    for state in sorted(set(k[1] for k in units)):
        grouped={};original={};unmapped=[]
        for turn in [1,2]:
            original[turn]={(k[1],k[2]):u for k,u in units.items() if k[0]==turn and k[1]==state and k[2] and not k[3]}
            grouped[turn],missing=group_regions(original[turn],crosswalk);unmapped+=missing
        if unmapped:
            output.append(unavailable_region(f'2026-6259-6260-3-{state}-ibge-immediate',2026,state,original[1],original[2],unmapped,official_sources+sources,'Eleição governador2026'))
            continue
        output.append(emit_contest(f'2026-6259-6260-3-{state}-ibge-immediate',2026,3,state,'',grouped[1],grouped[2],official_sources+sources,'Eleição governador2026','ibge-immediate-2026'))
    return output


def main():
    p=argparse.ArgumentParser();p.add_argument('--archive-root',required=True);a=p.parse_args()
    indexpath=Path('data/transfers/index.json');index=json.loads(indexpath.read_text())
    years=sorted(set(c['year'] for c in index['contests'] if c['office']==3 and c['year']<2026))
    entries=[]
    for year in years:
        rows=build_history(year,a.archive_root,regional=True);entries+=rows;print(year,len(rows),flush=True)
    entries+=build_2026_regions()
    with Path('.cache/transfers-index.lock').open('w') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        index=json.loads(indexpath.read_text());combined={c['id']:c for c in index['contests']}
        combined.update({c['id']:c for c in entries});index['contests']=list(combined.values())
        indexpath.write_text(json.dumps(index,ensure_ascii=False,indent=2)+'\n')

if __name__=='__main__':main()
