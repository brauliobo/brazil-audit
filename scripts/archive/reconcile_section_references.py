#!/usr/bin/env python3
"""Repair reference-member overlap from source-identified normalized caches."""
import argparse
import concurrent.futures
import hashlib
import json
import pathlib
from reference_members import reconcile, VERSION


def repair(path, root):
    body=path.read_bytes();record=json.loads(body)
    if record['table']['name']!='election_section_units':return None
    if record.get('referenceMemberSelection',{}).get('version')==VERSION:
        return dict(url=record['source']['source_url'],status='ready',cached=True,rows=record['rows'])
    digest=hashlib.sha256(body).hexdigest();relative=pathlib.Path('reference-unique')/digest[:16]
    result=reconcile(record,root,root/relative)
    for part in result['table']['parts'].values():part['url']=str(relative/part['url'])
    result['referenceMemberSelection']['inputIndexSha256']=digest
    archive=root/'reference-audit'/f'{digest}.json';archive.parent.mkdir(parents=True,exist_ok=True);archive.write_bytes(body)
    temporary=path.with_suffix('.tmp');temporary.write_text(json.dumps(result,ensure_ascii=False,indent=1)+'\n');temporary.replace(path)
    return dict(url=result['source']['source_url'],status='ready',rows=result['rows'],audit=result['referenceMemberSelection'])

def repair_job(path, root):
    try:return repair(path,root)
    except ValueError as error:
        record=json.loads(path.read_text());failure=dict(url=record['source']['source_url'],status='error',reason=str(error))
        target=root/'reference-errors'/path.name;target.parent.mkdir(parents=True,exist_ok=True);target.write_text(json.dumps(failure,ensure_ascii=False,indent=1)+'\n')
        return failure


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--input',type=pathlib.Path,required=True);p.add_argument('--workers',type=int,choices=range(1,5),default=4);p.add_argument('--source-url');a=p.parse_args()
    paths=[a.input/'sources'/(hashlib.sha256(a.source_url.encode()).hexdigest()+'.json')] if a.source_url else (a.input/'sources').glob('*.json')
    with concurrent.futures.ProcessPoolExecutor(max_workers=a.workers) as pool:
        futures=[pool.submit(repair_job,path,a.input) for path in paths]
        for future in concurrent.futures.as_completed(futures):
            result=future.result()
            if result:print(json.dumps(result,ensure_ascii=False),flush=True)
