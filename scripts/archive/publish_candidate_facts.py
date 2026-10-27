"""Publish normalized public facts from private staging into an immutable data branch.

The source tree stays outside Vite's public data directory. Only compact rollups
and the tiny identity audit are copied into --public-output. Large source tables
are addressed by their Git commit and each compressed part's SHA-256.
"""
import argparse,concurrent.futures,copy,hashlib,json,os,pathlib,shutil,subprocess,tempfile,urllib.request,zipfile


def digest(path):
    with path.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()


def copy_public_part(source,destination):
    destination.parent.mkdir(parents=True,exist_ok=True)
    temporary=destination.with_name(destination.name+'.tmp')
    shutil.copyfile(source,temporary);temporary.replace(destination)


def publish(root,public_output,repository,branch,release=None):
    workspace=pathlib.Path.cwd();index=json.loads((root/'index.json').read_text())
    index['sourceCommit']=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()
    (root/'index.json').write_text(json.dumps(index,ensure_ascii=False,indent=1)+'\n')
    shutil.copyfile('scripts/archive/CANDIDATE_FACTS.md',root/'METHOD.md')
    files=sorted({p['url'] for t in index['tables'].values() for p in t['parts'].values()})+['index.json','METHOD.md']
    for table in index['tables'].values():
        for p in table['parts'].values():
            if digest(root/p['url'])!=p['sha256']:raise ValueError('Staged part checksum differs from its declared source index')
    (root/'SHA256SUMS').write_text(''.join(digest(root/name)+'  '+name+'\n' for name in files));files.append('SHA256SUMS')
    remote=f'https://github.com/{repository}.git'
    with tempfile.TemporaryDirectory(prefix='electoral-facts-git-') as temporary:
        env={**os.environ,'GIT_INDEX_FILE':str(pathlib.Path(temporary)/'index'),'GIT_WORK_TREE':str(root.resolve())}
        git=['git','--git-dir='+str(workspace/'.git'),'--work-tree='+str(root.resolve())]
        subprocess.run(git+['read-tree','--empty'],env=env,check=True)
        paths=pathlib.Path(temporary)/'paths';paths.write_bytes(b'\0'.join(n.encode() for n in files)+b'\0')
        subprocess.run(git+['add','--pathspec-from-file='+str(paths),'--pathspec-file-nul'],env=env,check=True)
        tree=subprocess.check_output(git+['write-tree'],env=env,text=True).strip()
        refs=subprocess.check_output(['git','ls-remote',remote,'refs/heads/'+branch],text=True).strip()
        parent=refs.split()[0] if refs else None
        if parent:subprocess.run(['git','fetch',remote,branch],check=True)
        commit=subprocess.check_output(['git','commit-tree',tree]+(['-p',parent] if parent else []),input='results: publish official historical electoral facts\n',text=True).strip()
        subprocess.run(['git','-c','pack.threads=4','push',remote,commit+':refs/heads/'+branch],check=True)
        actual=subprocess.check_output(['git','ls-remote',remote,'refs/heads/'+branch],text=True).split()[0]
        if actual!=commit:raise ValueError('Published data branch does not match the staged commit')
    raw=f'https://raw.githubusercontent.com/{repository}/{commit}/'
    def check(item):
        table,part=item
        with urllib.request.urlopen(raw+part['url'],timeout=120) as response:body=response.read();cors=response.headers.get('Access-Control-Allow-Origin')
        if len(body)!=part['bytes'] or hashlib.sha256(body).hexdigest()!=part['sha256'] or cors!='*':raise ValueError('Browser transport checksum, length or CORS validation failed')
        return {'table':table,'sha256':part['sha256'],'bytes':len(body),'cors':cors}
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        verified=list(pool.map(check,[(t,next(iter(v['parts'].values()))) for t,v in index['tables'].items() if v['parts']]))
    public=copy.deepcopy(index)
    for name,table in public['tables'].items():
        for part in table['parts'].values():
            source=part['url'];part['remoteUrl']=raw+source
            if name in ['election_vote_rollups','candidate_identity']:
                destination=public_output/source;copy_public_part(root/source,destination)
                part['url']=str(destination.relative_to('data'))
            else:part['url']=raw+source
    public['remote']={'branch':branch,'commit':commit,'index':raw+'index.json','verified':verified}
    public_output.mkdir(parents=True,exist_ok=True);(public_output/'index.json').write_text(json.dumps(public,ensure_ascii=False,indent=1)+'\n')
    if release:publish_release(root,index,commit,repository,release)
    return commit


def publish_release(root,index,commit,repository,tag):
    output=root/'release';output.mkdir(exist_ok=True)
    grouped={}
    for table,definition in index['tables'].items():
        for p in definition['parts'].values():
            years=p['sourceYears']
            if len(years)!=1:raise ValueError('A release part must declare one source-year collection')
            grouped.setdefault(years[0],set()).add(p['url'])
    for year,files in grouped.items():
        with zipfile.ZipFile(output/f'historical-results-{year}.zip','w',compression=zipfile.ZIP_STORED,allowZip64=True) as z:
            for name in sorted(files):
                info=zipfile.ZipInfo(name,date_time=(1980,1,1,0,0,0));info.external_attr=0o644<<16;z.writestr(info,(root/name).read_bytes())
    shutil.copyfile(root/'index.json',output/'INDEX.json');shutil.copyfile(root/'METHOD.md',output/'METHOD.md')
    assets=sorted(p for p in output.iterdir() if p.name!='SHA256SUMS');(output/'SHA256SUMS').write_text(''.join(digest(p)+'  '+p.name+'\n' for p in assets));assets.append(output/'SHA256SUMS')
    result=subprocess.run(['gh','release','view',tag,'--repo',repository],capture_output=True)
    if result.returncode:subprocess.run(['gh','release','create',tag,'--repo',repository,'--target',commit,'--draft','--title','Historical electoral results and public nominations','--notes','Official historical source facts for browser SQL. Source URLs, hashes, original count meanings and territorial grain are preserved in INDEX.json and METHOD.md.'],check=True)
    def upload(p):subprocess.run(['gh','release','upload',tag,str(p),'--repo',repository,'--clobber'],check=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:list(pool.map(upload,assets))
    api=subprocess.check_output(['gh','release','view',tag,'--repo',repository,'--json','apiUrl','--jq','.apiUrl'],text=True).strip()
    metadata=json.loads(subprocess.check_output(['gh','api',api],text=True))
    actual={a['name']:a for a in metadata['assets']}
    if set(actual)!=set(p.name for p in assets):raise ValueError('Release asset set differs from the verified export')
    for p in assets:
        a=actual[p.name]
        if a['size']!=p.stat().st_size or a.get('digest')!='sha256:'+digest(p):raise ValueError('Remote release bytes/checksum mismatch')
    subprocess.run(['gh','release','edit',tag,'--repo',repository,'--draft=false'],check=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--staging-root',type=pathlib.Path,default=pathlib.Path('.cache/canonical-source-data/runtime-results'));parser.add_argument('--public-output',type=pathlib.Path,default=pathlib.Path('data/results-facts'));parser.add_argument('--repo',default='brauliobo/brazil-audit');parser.add_argument('--branch',default='data/historical-results');parser.add_argument('--release');args=parser.parse_args()
    print(json.dumps({'commit':publish(args.staging_root,args.public_output,args.repo,args.branch,args.release)}),flush=True)
