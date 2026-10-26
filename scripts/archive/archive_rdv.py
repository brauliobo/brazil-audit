#!/usr/bin/env python3
"""Select official RDV members without downloading unrelated logs, BUs and images."""
import argparse
import concurrent.futures
import hashlib
import json
import pathlib
import re
import subprocess
import time
import zipfile
from tse_archive import read_json, write_json, now, sha256, publish_prepared
from zip_range import RemoteZipFile

REPO = 'brauliobo/brazil-audit'
SOURCE = re.compile(r'(o\d+)([a-z]{2})(\d{13})-rdv\.dat$', re.I)
BARE = re.compile(r'(o\d+)-(\d{13})\.rdv$', re.I)
LEGACY = re.compile(r'(?:^|/)([a-z]{2})-[^/]+-(o\d+)-(\d{13})\.rdv$', re.I)


def identity(name, state=None):
    source = SOURCE.search(name)
    if source:
        event, state, section = source.groups()
        return f'{event.lower()}:{state.lower()}:{section}'
    legacy = LEGACY.search(name)
    if legacy:
        state, event, section = legacy.groups()
        return f'{event.lower()}:{state.lower()}:{section}'
    bare = BARE.search(name)
    if bare and state:
        event, section = bare.groups()
        return f'{event.lower()}:{state.lower()}:{section}'
    return None


def existing(root):
    path = root / 'catalog/existing-rdv-members.json'
    if path.exists():
        return read_json(path)
    assets = []
    for tag in ['data-2022', 'data-2026', 'data-2026-2']:
        release = json.loads(subprocess.check_output(['gh', 'api', f'repos/{REPO}/releases/tags/{tag}']))
        assets.extend({**a, 'tag': tag} for a in release['assets'] if '-rdv-' in a['name'] and a['name'].endswith('.zip'))
    def inspect(asset):
        with RemoteZipFile(asset['browser_download_url']) as remote, zipfile.ZipFile(remote) as archive:
            rows = {}
            for member in archive.infolist():
                key = identity(member.filename)
                if key:
                    rows[key] = dict(crc32=member.CRC, bytes=member.file_size, member=member.filename,
                                     asset=asset['browser_download_url'], assetDigest=asset.get('digest'), tag=asset['tag'])
            return rows
    result = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for rows in pool.map(inspect, assets):
            result.update(rows)
    write_json(path, result)
    print(f'Indexed {len(result)} existing RDV members', flush=True)
    return result


def extract_bundle(root, resource, reused):
    key = hashlib.sha256(resource['url'].encode()).hexdigest()
    directory = root / 'rdv' / key
    directory.mkdir(parents=True, exist_ok=True)
    state = directory / 'VERIFIED.json'
    if state.exists():
        result = read_json(state)
        if all((directory / a['name']).exists() and sha256(directory / a['name']) == a['sha256'] for a in result['assets']):
            return result, [directory / a['name'] for a in result['assets']]
    started = time.monotonic()
    with RemoteZipFile(resource['url']) as remote, zipfile.ZipFile(remote) as source:
        version = remote.size, remote.etag
        members = [m for m in source.infolist() if SOURCE.search(m.filename) or BARE.search(m.filename)]
        if not members:
            raise ValueError(f'No recognized RDV members in official bundle: {resource["url"]}')
        network, requests = remote.transferred, remote.requests
    state_match = re.search(r'_([A-Z]{2})\.zip$', resource['url'])
    state_code = state_match.group(1) if state_match else None
    matched = []
    selected = []
    for member in members:
        old = reused.get(identity(member.filename, state_code))
        if old and old['crc32'] == member.CRC and old['bytes'] == member.file_size:
            matched.append(dict(sourceMember=member.filename, verification='member-identity-size-crc32; existing asset digest recorded, source member SHA256 not established', **old))
        else:
            selected.append(member)
    def shard(task):
        index, names = task
        output = directory / f'{resource["id"][:8]}-rdv-{index:02d}.zip'
        partial = output.with_suffix('.zip.part')
        records = []
        with RemoteZipFile(resource['url'], version=version) as stream, zipfile.ZipFile(stream) as source, zipfile.ZipFile(partial, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as target:
            for member in names:
                data = source.read(member.filename)  # zipfile verifies source CRC, including ZIP64.
                target.writestr(member.filename, data)
                records.append(dict(name=member.filename, bytes=len(data), crc32=member.CRC, sha256=hashlib.sha256(data).hexdigest()))
            network, requests = stream.transferred, stream.requests
        partial.replace(output)
        with zipfile.ZipFile(output) as archive:
            if archive.testzip():
                raise ValueError('Output RDV ZIP CRC mismatch')
        return output, records, network, requests
    tasks = [(i, selected[i::8]) for i in range(min(8, len(selected)))]
    paths = []
    extracted = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        for output, records, transferred, count in pool.map(shard, tasks):
            paths.append(output)
            extracted.extend(records)
            network += transferred
            requests += count
    result = dict(url=resource['url'], etag=version[1], sourceBytes=version[0], retrievedAt=now(),
                  status='prepared', membersAvailable=len(members), membersExtracted=len(extracted), membersReused=len(matched),
                  reused=matched, extracted=extracted, networkBytes=network, requests=requests, elapsedSeconds=round(time.monotonic()-started, 2),
                  assets=[dict(name=p.name, bytes=p.stat().st_size, sha256=sha256(p)) for p in paths])
    write_json(state, result)
    print(json.dumps({k: result[k] for k in ['url', 'membersAvailable', 'membersExtracted', 'membersReused', 'networkBytes', 'elapsedSeconds']}), flush=True)
    return result, paths


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--root', type=pathlib.Path, default=pathlib.Path('.cache/tse-archive'))
    p.add_argument('--dataset', action='append')
    a = p.parse_args()
    catalog = read_json(a.root / 'catalog/catalog.json')
    reused = existing(a.root)
    for dataset in catalog['datasets']:
        resources = [r for r in dataset['resources'] if '/arqurnatot/' in r['url'] and r['url'].endswith('.zip')]
        if not resources or a.dataset and dataset['id'] not in a.dataset:
            continue
        collection = {**dataset, 'id': f'rdv-{dataset["id"]}', 'title': f'RDV · {dataset["title"]}',
                      'branch': f'archive/rdv-{dataset["id"]}', 'tag': f'data-rdv-{dataset["id"]}', 'resources': resources, 'inScope': True}
        entries, paths = [], []
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            for resource, (result, files) in zip(resources, pool.map(lambda r: extract_bundle(a.root, r, reused), resources)):
                entries.append({**resource, **result})
                paths.extend(files)
        # Per-member integrity and exact reuse evidence are release assets, not a huge Pages catalogue.
        detail = a.root / 'releases' / collection['id'] / 'MEMBERS.json'
        write_json(detail, dict(generatedAt=now(), sources=entries))
        paths.append(detail)
        compact = [{k: v for k, v in entry.items() if k not in ['extracted', 'reused']} for entry in entries]
        manifest = publish_prepared(a.root, collection, compact, paths)
        write_json(a.root / 'rdv' / f'{collection["id"]}.json', manifest)
        print(f'published {collection["id"]}', flush=True)


if __name__ == '__main__':
    main()
