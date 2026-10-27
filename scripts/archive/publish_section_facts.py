#!/usr/bin/env python3
"""Publish immutable section-fact packs in bounded Git pushes; release only the final inventory."""
import argparse
import copy
import fcntl
import gzip
import hashlib
import json
import os
import subprocess
import zipfile
from pathlib import Path

from tse_archive import GIT, REPO, CHUNK, command, now, read_json, write_json, sha256, publish_prepared

BRANCH='data/historical-sections'
MAX_PART=20_000_000
BATCH_BYTES=1_400_000_000


def bounded_batches(records,limit=BATCH_BYTES):
    batch=[];size=0
    for record in records:
        if record['bytes']>limit:raise ValueError('one artifact exceeds the push batch limit')
        if batch and size+record['bytes']>limit:
            yield batch;batch=[];size=0
        batch.append(record);size+=record['bytes']
    if batch:yield batch


def public_document(document):
    """The source exporter explicitly marks localFile as a private transport field."""
    if isinstance(document,dict):return {k:public_document(v) for k,v in document.items() if k!='localFile'}
    if isinstance(document,list):return [public_document(v) for v in document]
    if isinstance(document,str) and (document.startswith(('/srv/','/home/','file://')) or '.cache/historical-sections' in document):
        raise ValueError('private filesystem reference in public section metadata')
    return document


def snapshot_parts(packed_root,document):
    root=packed_root.resolve();parts=[]
    for table in document['tables'].values():
        for metadata in table['parts'].values():parts.append(metadata)
    parts+=document.get('sourceMetadata',[])
    records=[];seen={}
    for metadata in parts:
        relative=metadata.get('localFile',metadata['url'])
        path=(root/relative).resolve()
        if not path.is_relative_to(root):raise ValueError('section part escapes the declared packed root')
        body=path.read_bytes()
        digest=hashlib.sha256(body).hexdigest()
        if len(body)!=metadata['bytes'] or digest!=metadata['sha256']:
            raise ValueError(f'packed artifact changed after its source snapshot: {relative}')
        if len(body)>=MAX_PART:raise ValueError('section transport artifact must be below 20 MB')
        # Git receives exactly the bytes just verified, not a second filesystem read.
        blob=subprocess.check_output(['git','-c','core.compression=0','hash-object','-w','--stdin'],input=body).decode().strip()
        if relative in seen and seen[relative]!=digest:raise ValueError('conflicting section artifact path')
        if relative in seen:continue
        seen[relative]=digest
        records.append(dict(path=relative,blob=blob,bytes=len(body),sha256=digest))
    return records


def push_batches(root,records,branch=BRANCH,prune=False):
    state_dir=root/'browser-publications'/'sections';state_dir.mkdir(parents=True,exist_ok=True)
    receipt_path=state_dir/'STATE.json';receipt=read_json(receipt_path) if receipt_path.exists() else dict(branch=branch,files={},commits=[])
    if receipt['branch']!=branch:raise ValueError('section publication journal belongs to a different branch')
    current=command('git','ls-remote','--heads',GIT,f'refs/heads/{branch}')
    head=current.split()[0] if current else None
    planned=receipt.get('planned')
    if planned and head==planned['commit']:
        for record in planned['records']:receipt['files'][record['path']]={k:record[k] for k in ['sha256','bytes','blob']}
        for name in planned.get('removed',[]):receipt['files'].pop(name)
        receipt['head']=head;receipt['commits'].append(dict(commit=head,files=len(planned['records']),bytes=planned['bytes'],verifiedAt=now()))
        receipt.pop('planned');write_json(receipt_path,receipt)
    if receipt.get('head') and head!=receipt['head']:raise ValueError('remote section branch changed outside its publication journal')
    environment=dict(os.environ,GIT_INDEX_FILE=str(state_dir/'index.git'))
    if head:
        subprocess.run(['git','fetch','--no-tags','--no-write-fetch-head',GIT,head],check=True,stdout=subprocess.DEVNULL)
        subprocess.run(['git','read-tree',head],env=environment,check=True)
    else:subprocess.run(['git','read-tree','--empty'],env=environment,check=True)
    changed=[r for r in records if receipt['files'].get(r['path'],{}).get('sha256')!=r['sha256']]
    for batch in bounded_batches(changed):
        entries=''.join(f"100644 {r['blob']}\t{r['path']}\n" for r in batch)
        subprocess.run(['git','update-index','--index-info'],input=entries,text=True,env=environment,check=True)
        tree=subprocess.check_output(['git','write-tree'],env=environment,text=True).strip()
        args=['git','commit-tree',tree,'-m','sections: preserve observed electoral facts for browser queries']
        if head:args+=['-p',head]
        commit=command(*args)
        receipt['planned']=dict(commit=commit,records=batch,bytes=sum(r['bytes'] for r in batch))
        write_json(receipt_path,receipt)
        subprocess.run(['git','-c','pack.threads=4','-c','pack.window=0','push',GIT,f'{commit}:refs/heads/{branch}'],check=True,timeout=900)
        if command('git','ls-remote','--heads',GIT,f'refs/heads/{branch}').split()[0]!=commit:
            raise ValueError('remote section branch does not match the verified push')
        head=commit
        for record in batch:receipt['files'][record['path']]={k:record[k] for k in ['sha256','bytes','blob']}
        receipt['head']=head;receipt['commits'].append(dict(commit=head,files=len(batch),bytes=sum(r['bytes'] for r in batch),verifiedAt=now()))
        receipt.pop('planned',None)
        write_json(receipt_path,receipt)
        print(json.dumps(dict(commit=head,files=len(batch),bytes=sum(r['bytes'] for r in batch))),flush=True)
    if prune:
        obsolete=sorted(set(receipt['files'])-{r['path'] for r in records})
        if obsolete:
            # Only artifacts recorded by this publisher can be removed. Prior
            # immutable commits remain available; the final tree is exact.
            subprocess.run(['git','update-index','--force-remove','--',*obsolete],env=environment,check=True)
            tree=subprocess.check_output(['git','write-tree'],env=environment,text=True).strip()
            commit=command('git','commit-tree',tree,'-p',head,'-m','sections: retain the final verified factual inventory')
            receipt['planned']=dict(commit=commit,records=[],removed=obsolete,bytes=0)
            write_json(receipt_path,receipt)
            subprocess.run(['git','-c','pack.threads=4','push',GIT,f'{commit}:refs/heads/{branch}'],check=True,timeout=900)
            if command('git','ls-remote','--heads',GIT,f'refs/heads/{branch}').split()[0]!=commit:
                raise ValueError('remote section cleanup does not match the final inventory')
            for name in obsolete:receipt['files'].pop(name)
            head=commit;receipt['head']=head
            receipt['commits'].append(dict(commit=head,files=0,removed=len(obsolete),bytes=0,verifiedAt=now()))
            receipt.pop('planned',None);write_json(receipt_path,receipt)
    return head,receipt


def export_archives(packed_root,records,directory,limit=CHUNK):
    """Bundle already compressed, verified packs without changing their bytes."""
    directory.mkdir(parents=True,exist_ok=True);outputs=[]
    # Reserve bounded central-directory/header space rather than crossing the
    # release asset limit with many small metadata members.
    batches=bounded_batches([dict(r,bytes=r['bytes']+len(r['path'].encode())*2+256) for r in records],limit-65536)
    for number,batch in enumerate(batches):
        target=directory/f'sections-{number:04d}.zip';temporary=target.with_suffix('.zip.part')
        with zipfile.ZipFile(temporary,'w',compression=zipfile.ZIP_STORED,allowZip64=True) as archive:
            for record in batch:
                path=packed_root/record['path'];body=path.read_bytes()
                if hashlib.sha256(body).hexdigest()!=record['sha256']:
                    raise ValueError('section pack changed while preparing release export')
                member=zipfile.ZipInfo(record['path'],date_time=(1980,1,1,0,0,0));member.external_attr=0o100644<<16
                archive.writestr(member,body)
        if temporary.stat().st_size>=limit:raise ValueError('section release export exceeds asset limit')
        temporary.replace(target);outputs.append(target)
    return outputs


def publish_exports(root,packed_root,document,records,commit):
    """One yearly export release; browser queries keep immutable raw URLs."""
    fragment=pin_fragment(document,commit)
    for year in sorted({s['sourceYear'] for s in document['sources']}):
        sources=[s for s in document['sources'] if s['sourceYear']==year]
        urls={s['url'] for s in sources};selected={}
        for table in document['tables'].values():
            for p in table['parts'].values():
                if year in p['sourceYears']:selected[p.get('localFile',p['url'])]=True
        for p in document['sourceMetadata']:
            if p['source_url'] in urls:selected[p.get('localFile',p['url'])]=True
        files=[r for r in records if r['path'] in selected]
        identifier=f'historical-sections-{year}';directory=root/'releases'/identifier
        archives=export_archives(packed_root,files,directory)
        index=copy.deepcopy(fragment)
        index['sources']=[s for s in fragment['sources'] if s['sourceYear']==year]
        index['sourceMetadata']=[s for s in fragment['sourceMetadata'] if s['source_url'] in urls]
        for table in index['tables'].values():table['parts']={k:p for k,p in table['parts'].items() if year in p['sourceYears']}
        event_ids={eid for t in index['tables'].values() for p in t['parts'].values() for eid in p['electionIds']}
        index['eventOffices']=[o for o in index['eventOffices'] if o['election_id'] in event_ids]
        index['expectedSources']=len(sources);index['sourceCounts']={'ready':len(sources)}
        index['events']=[e for e in index.get('events',[]) if e.get('id',e.get('election_id')) in event_ids]
        write_json(directory/'index.json',index)
        entries=[dict(status='prepared',year=year,sourceUrls=sorted(urls),browserCommit=commit,
                      assets=[dict(name=p.name,bytes=p.stat().st_size,sha256=sha256(p)) for p in archives])]
        dataset=dict(id=identifier,title=f'Seções eleitorais {year} — fatos consultáveis',
            branch=f'archive/{identifier}',tag=f'data-{identifier}',source='https://dadosabertos.tse.jus.br',license='Licença declarada em cada fonte oficial')
        publish_prepared(root,dataset,entries,[*archives,directory/'index.json'],readme=f'# Seções eleitorais — {year}\n\nFatos normalizados das fontes oficiais do TSE, sem inferências estatísticas. index.json preserva esquemas, granularidades, fontes, hashes e URLs imutáveis para consultas no navegador. Os arquivos ZIP contêm as partes CSV gzip e os metadados de cobertura, preservando os bytes verificados.\n')


def pin_fragment(document,commit):
    result=public_document(copy.deepcopy(document))
    prefix=f'https://raw.githubusercontent.com/{REPO}/{commit}/'
    for table in result['tables'].values():
        for p in table['parts'].values():
            p['url']=prefix+p['url']
            if 'eventIds' in p:
                if 'electionIds' in p:raise ValueError('section metadata must declare one event-ID field')
                p['electionIds']=p.pop('eventIds')
    for p in result.get('sourceMetadata',[]):p['url']=prefix+p['url']
    for source in result.get('sources',[]):
        if source.get('coverageUrl'):source['coverageUrl']=prefix+source['coverageUrl']
    result['browserPublication']=dict(branch=BRANCH,commit=commit,transport='immutable-cors-raw-git')
    return result


def sync(root,packed_root,index_path,final=False,data_dir=Path('data')):
    directory=root/'browser-publications'/'sections';directory.mkdir(parents=True,exist_ok=True)
    with (directory/'publication.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        document=read_json(index_path)
        if final:
            if document['expectedSources']!=423 or document['sourceCounts'].get('ready')!=423:
                raise ValueError('final section publication requires all 423 source inventories')
            if any(n for status,n in document['sourceCounts'].items() if status!='ready') or document.get('unregisteredEvents'):
                raise ValueError('final section publication has unfinished, failed or unregistered sources')
        records=snapshot_parts(packed_root,document)
        # The source index is published only with a complete source inventory.
        if final:
            body=(json.dumps(public_document(document),ensure_ascii=False,separators=(',',':'))+'\n').encode()
            if len(body)>=MAX_PART:raise ValueError('section index must remain below 20 MB')
            blob=subprocess.check_output(['git','hash-object','-w','--stdin'],input=body).decode().strip()
            records.append(dict(path='index.json',blob=blob,bytes=len(body),sha256=hashlib.sha256(body).hexdigest()))
        head,receipt=push_batches(root,records,prune=final)
        if final:
            actual=set(receipt['files']);expected={r['path'] for r in records}
            if actual!=expected:raise ValueError('final section tree retains obsolete artifacts; reconcile the owned journal before publication')
            fragment=pin_fragment(document,head)
            write_json(data_dir/'section-facts/index.json',fragment)
            write_json(directory/'VERIFIED.json',dict(commit=head,files=len(records),bytes=sum(r['bytes'] for r in records),sourceCount=423,verifiedAt=now()))
            publish_exports(root,packed_root,document,records,head)
        return dict(commit=head,files=len(records),sources=document['sourceCounts'],final=final)


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--root',type=Path,default=Path('.cache/tse-archive'))
    parser.add_argument('--packed-root',type=Path,default=Path('.cache/historical-sections/packed'))
    parser.add_argument('--index',type=Path);parser.add_argument('--final',action='store_true');parser.add_argument('--data-dir',type=Path,default=Path('data'))
    args=parser.parse_args();index=args.index or args.packed_root/'index.json'
    print(json.dumps(sync(args.root,args.packed_root,index,args.final,args.data_dir)),flush=True)
