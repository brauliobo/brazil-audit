#!/usr/bin/env python3
"""Publish bounded browser factual parts, with release exports and immutable provenance."""
import argparse
import csv
import gzip
import hashlib
import json
import os
import shutil
import subprocess
import zipfile
from pathlib import Path

from normalize_profiles import FIELDS, AXES, METRICS, PartWriter, profile_sources, schema
from integrate_electoral_facts import fingerprint
from tse_archive import GIT, REPO, command, now, publish_prepared, read_json, sha256, write_json

BRANCH = 'data/historical-profiles'
MAX_PART = 20_000_000


def sql_literal(value):
    return "'" + value.replace("'", "''") + "'"


def split_city_parts(source, directory):
    """A COPY partition is a disjoint city-code interval, never an arbitrary byte cut."""
    writers = {}
    with gzip.open(source, 'rt', newline='') as stream:
        for row in csv.DictReader(stream, fieldnames=FIELDS):
            city = row['city_code']; bucket = int(city) // 1000 if city else None
            label = str(bucket).zfill(2) if bucket is not None else 'unknown'
            if label not in writers:
                writers[label] = PartWriter(directory / f'{source.stem.removesuffix(".csv")}.{label}.csv.gz')
            writers[label].write(row)
    result = []
    for label, writer in writers.items():
        metadata = writer.close()
        if metadata['bytes'] >= MAX_PART:
            raise ValueError('city-code demographic partition exceeds 20 MB; refine the owning partition definition')
        condition = 'city_code is null' if label == 'unknown' else f"city_code >= '{int(label)*1000:05d}' and city_code < '{(int(label)+1)*1000:05d}'"
        result.append((label, writer.path, metadata, condition))
    return result


def prepare(root, data_dir):
    sources = profile_sources(read_json(root / 'catalog/catalog.json'))
    directory = root / 'profiles-transport'; directory.mkdir(parents=True, exist_ok=True)
    datasets = []; parts = {}; files = {}
    for source in sources:
        source_index = root / 'profiles' / source['dataset_id'] / 'index.json'
        document = read_json(source_index)
        if not document['complete']:
            raise ValueError('partial demographic normalization cannot be published')
        public = {k: v for k, v in document.items() if k not in ['parts', 'elapsedSeconds']}
        public['parts'] = []
        for ident, metadata in document['parts'].items():
            path = root / 'profiles' / metadata['localFile']
            if sha256(path) != metadata['sha256']:
                raise ValueError('normalized demographic part digest mismatch')
            dataset = source['dataset_id']; state = metadata['state']; level = metadata['level']
            where = f'dataset_id = {sql_literal(dataset)} and state = {sql_literal(state)} and level = {sql_literal(level)}'
            if metadata['bytes'] >= MAX_PART:
                if level != 'detail':
                    raise ValueError('state demographic cube exceeds 20 MB')
                pieces = split_city_parts(path, directory / dataset)
            else:
                pieces = [(None, path, {k: metadata[k] for k in ['rows','bytes','rawBytes','sha256']}, None)]
            for suffix, piece, stats, condition in pieces:
                name = piece.name; relative = f'{dataset}/{name}'
                destination = directory / relative; destination.parent.mkdir(parents=True, exist_ok=True)
                if piece != destination:
                    if destination.exists(): destination.unlink()
                    os.link(piece, destination)
                pid = ident + (f'.{suffix}' if suffix else '')
                record = dict(stats, state=state, level=level, grains=metadata['grains'],
                              datasetId=dataset, where=where + (f' and {condition}' if condition else ''),
                              relative=relative)
                files[relative] = destination
                if level == 'state':
                    local = data_dir / 'profiles' / relative; local.parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(destination, local)
                    record['url'] = f'profiles/{relative}'
                parts[pid] = record; public['parts'].append(pid)
        datasets.append(public)
    public_index = dict(version=1, datasets=datasets,
        axes={key: dict(code=key+'_code', label=key) for key in AXES} | {'vote_obligation':dict(code=None,label='vote_obligation')},
        metrics={key: dict(column=key, sourceColumns=list(aliases)) for key, aliases in METRICS.items()},
        levels={'state':'Additive demographic cells summed over disjoint source cities/zones; never add to detail cells.',
                'detail':'Original demographic cells at their reported municipality/zone grain.'},
        table=schema({}), rows=sum(d['rows'] for d in datasets),
        sourceSelection='Use the nationwide BRASIL cell CSV when supplied; UF copies are not added a second time.')
    write_json(directory / 'index.json', public_index); files['index.json'] = directory / 'index.json'
    return directory, public_index, parts, files


def push_data_branch(root, files):
    environment = dict(os.environ, GIT_INDEX_FILE=str(root / 'profiles-transport-index.git'))
    subprocess.run(['git','read-tree','--empty'],env=environment,check=True)
    entries=[]
    for name, path in sorted(files.items()):
        digest=command('git','hash-object','-w',str(path));entries.append(f'100644 {digest}\t{name}\n')
    subprocess.run(['git','update-index','--index-info'],input=''.join(entries),text=True,env=environment,check=True)
    tree=subprocess.check_output(['git','write-tree'],env=environment,text=True).strip()
    remote=command('git','ls-remote','--heads',GIT,f'refs/heads/{BRANCH}');old=remote.split()[0] if remote else None
    args=['git','commit-tree',tree,'-m','electorate: preserve demographic facts for browser queries']
    if old:
        subprocess.run(['git','fetch','--no-tags','--no-write-fetch-head',GIT,old],check=True,stdout=subprocess.DEVNULL)
        args+=['-p',old]
    commit=command(*args)
    subprocess.run(['git','push',GIT,f'{commit}:refs/heads/{BRANCH}'],check=True)
    if command('git','ls-remote','--heads',GIT,f'refs/heads/{BRANCH}').split()[0]!=commit:
        raise ValueError('remote demographic branch target mismatch')
    return commit


def integrate(data_dir, public_index, parts, commit):
    for p in parts.values():
        if p['level']=='detail':p['url']=f'https://raw.githubusercontent.com/{REPO}/{commit}/{p["relative"]}'
        p.pop('relative')
    document=dict(public_index, branch=BRANCH, commit=commit, table='election_profiles')
    write_json(data_dir/'profiles/index.json',document)
    path=data_dir/'manifest.json';manifest=read_json(path);manifest['tables']['election_profiles']=schema(parts)
    manifest['profiles']=dict(index='profiles/index.json', datasets=len(public_index['datasets']),rows=public_index['rows'],
        availableYears=sorted({y for d in public_index['datasets'] for y in d['years']}),
        snapshotYears=sorted({y for d in public_index['datasets'] if d['kind']=='electorate' for y in d['years']}),
        attendanceYears=sorted({y for d in public_index['datasets'] if d['kind']=='attendance' for y in d['years']}))
    manifest['version']=manifest['version'].split('+')[0]+'+facts-'+fingerprint(manifest)
    path.write_text(json.dumps(manifest,ensure_ascii=False,indent=1)+'\n')
    registry_path=data_dir/'elections.json';registry=read_json(registry_path)
    registry['profiles']=dict(index='profiles/index.json',table='election_profiles',
        datasets=[dict(id=d['datasetId'],kind=d['kind'],years=d['years'],turns=d['turns'],axes=d['axes'],metrics=d['metrics']) for d in public_index['datasets']])
    write_json(registry_path,registry)


def export_release(root,directory,public_index,files):
    target=root/'profile-exports';target.mkdir(parents=True,exist_ok=True);paths=[];entries=[]
    for dataset in public_index['datasets']:
        name=dataset['datasetId'];path=target/f'{name}.zip'
        with zipfile.ZipFile(path,'w',compression=zipfile.ZIP_STORED,allowZip64=True) as archive:
            for relative, file in files.items():
                if relative.startswith(name+'/'):
                    entry=zipfile.ZipInfo(relative,date_time=(1980,1,1,0,0,0));entry.compress_type=zipfile.ZIP_STORED
                    with file.open('rb') as source, archive.open(entry,'w',force_zip64=True) as destination:
                        shutil.copyfileobj(source,destination)
            entry=zipfile.ZipInfo('INDEX.json',date_time=(1980,1,1,0,0,0))
            archive.writestr(entry,json.dumps(dataset,ensure_ascii=False,indent=2)+'\n')
        paths.append(path);entries.append(dict(id=name,url=dataset['sourceUrl'],sha256=dataset['sourceSha256'],status='prepared',
            assets=[dict(name=path.name,bytes=path.stat().st_size,sha256=sha256(path))]))
    dataset=dict(id='historical-profiles',title='Perfis históricos de eleitorado e comparecimento — fatos completos',
        source='https://dadosabertos.tse.jus.br',license='cc-by',branch='archive/historical-profiles',tag='data-historical-profiles')
    readme = ('# Perfis históricos de eleitorado e comparecimento\n\n'
        'Células demográficas oficiais completas, normalizadas para consultas SQL no navegador. '
        'Cada ZIP contém os CSVs gzip e o índice com campos, fonte original e SHA256.\n\n'
        'O nível state soma células territoriais disjuntas conservando todas as dimensões; '
        'detail conserva município/zona da fonte. Nunca some os dois níveis. '
        'Eleitorado é um retrato cadastral por ano da fonte, não o eleitorado de qualquer pleito suplementar. '
        'Comparecimento conserva somente os turnos efetivamente informados. '
        'Códigos demográficos negativos e rótulos originais permanecem; medidas ausentes são NULL.\n\n'
        'Fonte e licença: https://dadosabertos.tse.jus.br (CC BY). '
        'ARCHIVE.json e SHA256SUMS verificam todos os arquivos publicados.\n')
    return publish_prepared(root,dataset,entries,paths,readme=readme)


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--root',type=Path,default=Path('.cache/tse-archive'))
    parser.add_argument('--data-dir',type=Path,default=Path('data'));parser.add_argument('--prepare-only',action='store_true')
    args=parser.parse_args();directory,index,parts,files=prepare(args.root,args.data_dir)
    print(json.dumps({'datasets':len(index['datasets']),'rows':index['rows'],'parts':len(parts),'bytes':sum(p['bytes'] for p in parts.values())}),flush=True)
    if not args.prepare_only:
        commit=push_data_branch(args.root,files);integrate(args.data_dir,index,parts,commit)
        print(json.dumps({'branch':BRANCH,'commit':commit}),flush=True)
        export_release(args.root,directory,index,files)
