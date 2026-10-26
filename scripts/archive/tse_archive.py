#!/usr/bin/env python3
"""Inventory, archive and publish the official TSE CKAN resources, one collection per release."""
import argparse
import concurrent.futures
import csv
import datetime
import fcntl
import hashlib
import io
import json
import os
import pathlib
import re
import shutil
import subprocess
import urllib.parse
import urllib.request
import zipfile

API = 'https://dadosabertos.tse.jus.br/api/3/action/package_search'
REPO = 'brauliobo/brazil-audit'
GIT = f'https://github.com/{REPO}.git'
PERSONAL = re.compile(r'CPF|TITULO_ELEITOR|EMAIL|E_MAIL|TELEFONE|CELULAR|CONTA_BANCARIA|AGENCIA_BANCARIA|ENDERECO_RESIDENCIAL', re.I)
CHUNK = 1900 * 1024 * 1024
CORE = {'votacao_secao', 'detalhe_votacao_secao', 'votacao_candidato_munzona', 'votacao_partido_munzona', 'detalhe_votacao_munzona', 'votacao_candidato_uf', 'votacao_partido_uf', 'detalhe_votacao_uf', 'consulta_cand', 'consulta_legendas', 'consulta_coligacao', 'consulta_vagas', 'consulta_cand_complementar', 'eleitorado_locais_votacao', 'secoes_agregadas', 'perfil_eleitorado', 'perfil_comparecimento_abstencao'}


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.part')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(path)


def read_json(path):
    return json.loads(path.read_text())


def sha256(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(4 * 1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def public_columns(fields):
    return [i for i, field in enumerate(fields) if not PERSONAL.search(field)]


def in_scope(resource):
    path = urllib.parse.urlsplit(resource['url']).path
    return '/odsele/' in path and path.split('/odsele/', 1)[1].split('/', 1)[0] in CORE


def resource_policy(resource):
    return 'privacy-review-required' if '/certidao_criminal/' in resource['url'] else None


def catalogue(packages):
    datasets = []
    all_urls = set()
    for p in sorted(packages, key=lambda p: p['name']):
        years = sorted({int(y) for y in re.findall(r'(?<!\d)((?:19|20)\d{2})(?!\d)', p['name'])})
        resources = []
        for r in p['resources']:
            original_url = r.get('url', '')
            url = original_url.removeprefix('URL: ').strip()
            supported = urllib.parse.urlsplit(url).scheme == 'https' and urllib.parse.urlsplit(url).hostname == 'cdn.tse.jus.br'
            if supported:
                all_urls.add(url)
            resources.append(dict(id=r['id'], name=r.get('name', ''), url=url, originalUrl=original_url, format=r.get('format', ''),
                                  status='catalogued' if supported else 'unsupported-url'))
        groups = [g['name'] for g in p.get('groups', [])]
        datasets.append(dict(id=p['name'], title=p['title'], groups=groups, family=groups[0] if groups else 'outros',
                             years=years, license=p.get('license_id'), source=f"https://dadosabertos.tse.jus.br/dataset/{p['name']}",
                             branch=f"archive/{p['name']}", tag=f"data-{p['name']}",
                             releaseUrl=f"https://github.com/{REPO}/releases/tag/data-{p['name']}",
                             normalized=False, status='catalogued', resources=resources))
    years = [y for d in datasets for y in d['years']]
    return dict(schemaVersion=1, generatedAt=now(), source=dict(url=API, license='cc-by'), earliestYear=min(years),
                datasetCount=len(datasets), resourceCount=sum(len(d['resources']) for d in datasets), uniqueUrlCount=len(all_urls), datasets=datasets)


def inventory(root, output):
    packages = []
    start = 0
    while True:
        with urllib.request.urlopen(f'{API}?rows=100&start={start}', timeout=45) as response:
            result = json.load(response)['result']
        packages.extend(result['results'])
        start += len(result['results'])
        if start >= result['count']:
            break
    write_json(root / 'catalog/packages.json', packages)
    result = catalogue(packages)
    write_json(root / 'catalog/catalog.json', result)
    if output:
        write_json(pathlib.Path(output), result)
    print(json.dumps({k: result[k] for k in ['datasetCount', 'resourceCount', 'uniqueUrlCount', 'earliestYear']}), flush=True)


def probe(root, workers):
    catalog = read_json(root / 'catalog/catalog.json')
    file = root / 'catalog/heads.jsonl'
    known = {r['url']: r for line in file.read_text().splitlines() if (r := json.loads(line))} if file.exists() else {}
    urls = sorted({r['url'] for d in catalog['datasets'] for r in d['resources'] if r['status'] != 'unsupported-url'})
    def head(url):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, method='HEAD'), timeout=40) as r:
                return dict(url=url, status=r.status, bytes=int(r.headers['Content-Length']) if r.headers.get('Content-Length') else None,
                            etag=r.headers.get('ETag'), lastModified=r.headers.get('Last-Modified'), contentType=r.headers.get('Content-Type'))
        except Exception as e:
            return dict(url=url, error=str(e))
    with file.open('a') as out, concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        for i, result in enumerate(pool.map(head, [url for url in urls if url not in known])):
            out.write(json.dumps(result) + '\n')
            out.flush()
            if i % 250 == 0:
                print(f'probed {len(known) + i}', flush=True)


def download(root, resource):
    key = hashlib.sha256(resource['url'].encode()).hexdigest()
    directory = root / 'downloads' / key
    directory.mkdir(parents=True, exist_ok=True)
    with (directory / 'download.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        return _download(root, resource)


def _download(root, resource):
    url = resource['url']
    key = hashlib.sha256(url.encode()).hexdigest()
    directory = root / 'downloads' / key
    state = directory / 'state.json'
    path = directory / pathlib.PurePosixPath(urllib.parse.urlsplit(url).path).name
    if state.exists():
        record = read_json(state)
        if path.exists() and path.stat().st_size == record['bytes'] and sha256(path) == record['sha256']:
            return path, record
    directory.mkdir(parents=True, exist_ok=True)
    part = path.with_suffix(path.suffix + '.part')
    # curl resumes only its own partial file; errors remain errors, never empty archive substitutes.
    subprocess.run(['curl', '-fL', '--retry', '3', '--retry-delay', '2', '--connect-timeout', '30', '--speed-time', '120',
                    '--speed-limit', '1024', '--continue-at', '-', '--output', str(part), url], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    if zipfile.is_zipfile(part):
        with zipfile.ZipFile(part) as archive:
            bad = archive.testzip()
            if bad:
                raise ValueError(f'ZIP CRC mismatch: {url} / {bad}')
    part.replace(path)
    record = dict(url=url, downloadedAt=now(), bytes=path.stat().st_size, sha256=sha256(path))
    write_json(state, record)
    return path, record


def public_copy(path, output):
    """Remove direct personal identifiers from tabular resources before public republication."""
    removed = {}
    if not zipfile.is_zipfile(path):
        output.unlink(missing_ok=True)
        os.link(path, output)
        return removed
    with zipfile.ZipFile(path) as source:
        needs_redaction = False
        for member in source.infolist():
            if member.filename.lower().endswith(('.csv', '.txt')):
                with source.open(member) as raw:
                    header = raw.readline().decode('latin1')
                if PERSONAL.search(header):
                    needs_redaction = True
                    break
    if not needs_redaction:
        output.unlink(missing_ok=True)
        os.link(path, output)
        return removed
    with zipfile.ZipFile(path) as source, zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as target:
        for member in source.infolist():
            if member.is_dir():
                target.writestr(member, b'')
                continue
            if not member.filename.lower().endswith(('.csv', '.txt')):
                with source.open(member) as inp, target.open(member.filename, 'w', force_zip64=True) as out:
                    shutil.copyfileobj(inp, out, 4 * 1024 * 1024)
                continue
            with source.open(member) as raw:
                first = raw.readline()
            header = first.decode('latin1').lstrip('\ufeff')
            delimiter = ';' if header.count(';') > header.count(',') else ','
            fields = next(csv.reader([header], delimiter=delimiter))
            keep = public_columns(fields)
            if len(keep) == len(fields):
                with source.open(member) as inp, target.open(member.filename, 'w', force_zip64=True) as out:
                    shutil.copyfileobj(inp, out, 4 * 1024 * 1024)
            else:
                removed[member.filename] = [f for i, f in enumerate(fields) if i not in keep]
                with source.open(member) as raw, target.open(member.filename, 'w', force_zip64=True) as dest:
                    inp = io.TextIOWrapper(raw, encoding='latin1', newline='')
                    out = io.TextIOWrapper(dest, encoding='utf8', newline='')
                    writer = csv.writer(out, delimiter=delimiter, lineterminator='\n', quoting=csv.QUOTE_ALL)
                    for row in csv.reader(inp, delimiter=delimiter):
                        writer.writerow([row[i] for i in keep])
                    out.flush()
    return removed


def command(*args, input=None):
    return subprocess.check_output(list(args), input=input, text=True).strip()


def publish(root, dataset):
    directory = root / 'releases' / dataset['id']
    directory.mkdir(parents=True, exist_ok=True)
    entries = []
    paths = []
    for resource in dataset['resources']:
        if resource['status'] in ['unsupported-url', 'unavailable', 'excluded']:
            entries.append(resource.copy())
            continue
        if resource_policy(resource):
            entries.append({**resource, 'status': 'privacy-review-required', 'reason': 'Criminal-record documents can expose direct personal identifiers; not automatically republished.'})
            continue
        source, record = download(root, resource)
        output = directory / f"{resource['id'][:8]}-{source.name}"
        removed = public_copy(source, output)
        published = []
        if output.stat().st_size > CHUNK:
            with output.open('rb') as inp:
                i = 0
                while first := inp.read(4 * 1024 * 1024):
                    piece = output.with_name(f'{output.name}.part{i:04d}')
                    with piece.open('wb') as out:
                        out.write(first)
                        left = CHUNK - len(first)
                        while left > 0:
                            chunk = inp.read(min(left, 4 * 1024 * 1024))
                            if not chunk:
                                break
                            out.write(chunk)
                            left -= len(chunk)
                    published.append(piece)
                    i += 1
        else:
            published.append(output)
        assets = [dict(name=p.name, bytes=p.stat().st_size, sha256=sha256(p)) for p in published]
        paths.extend(published)
        entries.append({**resource, **record, 'status': 'prepared', 'removedPersonalColumns': removed, 'assets': assets})
    return publish_prepared(root, dataset, entries, paths)


def resource_complete(entry):
    if entry['status'] in ['prepared', 'excluded']:
        return True
    return entry['status'] == 'unavailable' and entry.get('availability') in ['empty_source', 'no-rdv-published'] and entry.get('membersAvailable') == 0 and entry.get('inventoryVerified') is True


def publish_prepared(root, dataset, entries, paths):
    directory = root / 'releases' / dataset['id']
    directory.mkdir(parents=True, exist_ok=True)
    status = 'published' if all(resource_complete(e) for e in entries) else 'partial'
    manifest = dict(schemaVersion=1, generatedAt=now(), status=status, dataset={k: v for k, v in dataset.items() if k != 'resources'}, resources=entries)
    write_json(directory / 'ARCHIVE.json', manifest)
    sums = '\n'.join(f'{sha256(path)}  {path.name}' for path in paths) + '\n'
    (directory / 'SHA256SUMS').write_text(sums)
    readme = f"# {dataset['title']}\n\nFonte: {dataset['source']}\n\nLicença: {dataset['license']}. Dados arquivados, ainda não normalizados para todas as análises.\n\nARCHIVE.json identifica URL, instante, hash original, assets publicados e eventuais colunas pessoais removidas. Arquivos multipartes devem ser concatenados em ordem antes da extração.\n"
    (directory / 'README.md').write_text(readme)
    files = ['ARCHIVE.json', 'SHA256SUMS', 'README.md']
    tree_input = ''
    for name in files:
        blob = command('git', 'hash-object', '-w', str(directory / name))
        tree_input += f'100644 blob {blob}\t{name}\n'
    tree = command('git', 'mktree', input=tree_input)
    branch = dataset['branch']
    remote = command('git', 'ls-remote', '--heads', GIT, f'refs/heads/{branch}')
    parent = remote.split()[0] if remote else None
    if parent:
        subprocess.run(['git', 'fetch', '--no-tags', '--no-write-fetch-head', GIT, parent], check=True, stdout=subprocess.DEVNULL)
    args = ['git', 'commit-tree', tree, '-m', f"archive: preserve official {dataset['id']} sources"]
    if parent:
        args.extend(['-p', parent])
    commit = command(*args)
    subprocess.run(['git', 'push', GIT, f'{commit}:refs/heads/{branch}'], check=True)
    exists = subprocess.run(['gh', 'release', 'view', dataset['tag'], '-R', REPO], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
    if not exists:
        subprocess.run(['gh', 'release', 'create', dataset['tag'], '-R', REPO, '--target', branch, '--title', dataset['title'], '--notes-file', str(directory / 'README.md'), '--draft'], check=True)
    release_api = command('gh', 'release', 'view', dataset['tag'], '-R', REPO, '--json', 'apiUrl', '--jq', '.apiUrl')
    current = json.loads(command('gh', 'api', release_api, '--jq', '.assets'))
    known = {a['name']: (a['size'], a.get('digest')) for a in current}
    for path in paths + [directory / name for name in files]:
        if known.get(path.name) == (path.stat().st_size, f'sha256:{sha256(path)}'):
            continue
        # An established GitHub upload may stall indefinitely after a broken TCP path.
        # Reconnect bounded attempts; no successful-state substitute is written on failure.
        for attempt in range(3):
            try:
                subprocess.run(['gh', 'release', 'upload', dataset['tag'], str(path), '-R', REPO, '--clobber'], check=True, timeout=300)
                break
            except (subprocess.TimeoutExpired, subprocess.CalledProcessError):
                if attempt == 2:
                    raise
    assets = json.loads(command('gh', 'api', release_api, '--jq', '.assets'))
    expected = {p.name: (p.stat().st_size, sha256(p)) for p in paths + [directory / name for name in files]}
    remote_assets = {a['name']: (a['size'], a.get('digest')) for a in assets}
    if set(expected) != set(remote_assets):
        raise ValueError(f'Asset set mismatch: {dataset["id"]}')
    for name, (size, digest) in expected.items():
        if remote_assets[name] != (size, f'sha256:{digest}'):
            raise ValueError(f'Remote digest or size mismatch: {name}')
    subprocess.run(['gh', 'release', 'edit', dataset['tag'], '-R', REPO, '--draft=false'], check=True)
    write_json(directory / 'VERIFIED.json', dict(verifiedAt=now(), commit=commit, assets=len(expected), bytes=sum(v[0] for v in expected.values())))
    return manifest


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('action', choices=['catalog', 'probe', 'publish'])
    p.add_argument('--root', type=pathlib.Path, default=pathlib.Path('.cache/tse-archive'))
    p.add_argument('--output')
    p.add_argument('--workers', type=int, default=4)
    p.add_argument('--dataset', action='append', default=[])
    p.add_argument('--max-collection-gb', type=float)
    p.add_argument('--catalog-output')
    args = p.parse_args()
    if args.action == 'catalog':
        inventory(args.root, args.output)
    elif args.action == 'probe':
        probe(args.root, args.workers)
    else:
        catalog = read_json(args.root / 'catalog/catalog.json')
        selected = [d for d in catalog['datasets'] if not args.dataset or d['id'] in args.dataset]
        selected = [d for d in selected if d.get('inScope', True) and d['status'] not in ['published', 'partial']]
        if args.max_collection_gb is not None:
            selected = [d for d in selected if sum(r.get('bytes') or 0 for r in d['resources'] if not resource_policy(r)) <= args.max_collection_gb * 10**9]
        selected.sort(key=lambda d: (min(d['years'], default=9999), d['id']))
        with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
            jobs = {pool.submit(publish, args.root, d): d for d in selected}
            for job in concurrent.futures.as_completed(jobs):
                dataset = jobs[job]
                manifest = job.result()
                dataset['status'] = manifest['status']
                dataset['publicationVerifiedAt'] = now()
                for old, resource in zip(dataset['resources'], manifest['resources']):
                    old.update({k: resource[k] for k in ['status', 'bytes', 'sha256', 'assets', 'removedPersonalColumns'] if k in resource})
                    if old['status'] == 'prepared':
                        old['status'] = 'published'
                write_json(args.root / 'catalog/catalog.json', catalog)
                if args.catalog_output:
                    write_json(pathlib.Path(args.catalog_output), catalog)
                print(f'published {dataset["id"]}', flush=True)


if __name__ == '__main__':
    main()
