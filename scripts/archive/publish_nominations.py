#!/usr/bin/env python3
"""Publish source-reported lists and vacancies for browser queries and export."""
import argparse
import copy
import fcntl
import hashlib
import json
import os
import subprocess
from pathlib import Path

from publish_section_facts import snapshot_parts,push_batches,public_document,export_archives
from tse_archive import REPO,read_json,write_json,sha256,publish_prepared,command

BRANCH='data/historical-nominations'


def publish(root,data_dir):
    source=root/'normalized-nominations';index=read_json(source/'nominations/index.json')
    journal=root/'browser-publications/nominations';journal.mkdir(parents=True,exist_ok=True)
    with (journal/'publication.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        records=snapshot_parts(source,index)
        index['producerCommit']=command('git','rev-parse','HEAD')
        body=(json.dumps(public_document(index),ensure_ascii=False,separators=(',',':'))+'\n').encode()
        blob=subprocess.check_output(['git','hash-object','-w','--stdin'],input=body).decode().strip()
        records.append(dict(path='index.json',blob=blob,bytes=len(body),sha256=hashlib.sha256(body).hexdigest()))
        commit,receipt=push_batches(root,records,branch=BRANCH,prune=True,journal_name='nominations')
        if set(receipt['files'])!={r['path'] for r in records}:raise ValueError('nomination publication tree differs from source inventory')
        public=copy.deepcopy(index)
        for name,table in public['tables'].items():
            for part in table['parts'].values():
                relative=part['url'];original=source/relative
                if name!='election_lists' or max(part['sourceYears'])<=1990:
                    destination=data_dir/relative;destination.parent.mkdir(parents=True,exist_ok=True);destination.unlink(missing_ok=True);os.link(original,destination)
                else:part['url']=f'https://raw.githubusercontent.com/{REPO}/{commit}/{relative}'
        public['browserPublication']=dict(branch=BRANCH,commit=commit)
        write_json(data_dir/'nominations/index.json',public)
        directory=root/'releases/historical-nominations';directory.mkdir(parents=True,exist_ok=True)
        archives=export_archives(source,[r for r in records if r['path']!='index.json'],directory,prefix='nominations')
        write_json(directory/'index.json',dict(index,browserPublication=public['browserPublication']))
        paths=[*archives,directory/'index.json']
        entries=[dict(status='prepared',sources=index['sources'],assets=[dict(name=p.name,bytes=p.stat().st_size,sha256=sha256(p)) for p in paths])]
        dataset=dict(id='historical-nominations',title='Legendas e vagas declaradas — fontes históricas e atuais',
            branch='archive/historical-nominations',tag='data-historical-nominations',source='https://dadosabertos.tse.jus.br',license='Licença declarada em cada fonte oficial')
        publish_prepared(root,dataset,entries,paths,readme='# Legendas, vagas e vínculos declarados\n\nFatos das fontes arquivadas do TSE, incluindo partidos, coligações e federações. Ano/turno/data/cargo e jurisdição são preservados. Uma referência de contexto sem election_id não equivale a um pleito identificado. Vagas declaradas não representam eleitos observados nem uma simulação de cadeiras. Vínculos de candidato conservam a sequência da fonte; uma identidade não comprovada permanece NULL.\n')
        return dict(commit=commit,rows={k:sum(p['rows'] for p in t['parts'].values()) for k,t in public['tables'].items()})


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--root',type=Path,default=Path('.cache/tse-archive'));parser.add_argument('--data-dir',type=Path,default=Path('data'))
    args=parser.parse_args();print(json.dumps(publish(args.root,args.data_dir)),flush=True)
