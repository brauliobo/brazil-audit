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
import threading
import zipfile
from tse_archive import read_json, write_json, now, sha256, publish_prepared
from zip_range import RemoteZipFile

REPO = 'brauliobo/brazil-audit'
STREAMS = 16
NETWORK_SLOTS = threading.BoundedSemaphore(32)
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
    started = time.monotonic()
    documents = []
    source_archive_sha256 = None
    with NETWORK_SLOTS, RemoteZipFile(resource['url'], capture=True) as remote, zipfile.ZipFile(remote) as source:
        version = remote.size, remote.etag
        all_members = source.infolist()
        members = [m for m in all_members if m.filename.lower().endswith(('.rdv', '-rdv.dat'))]
        unknown = [m.filename for m in all_members if not m.is_dir() and 'rdv' in m.filename.lower() and not m.filename.lower().endswith(('.rdv', '-rdv.dat', '.pdf', '.txt', '.md'))]
        if unknown:
            raise ValueError(f'Unsupported RDV member format: {unknown}')
        if not members and all(m.is_dir() or m.filename.lower().endswith(('.pdf', '.txt', '.md')) for m in all_members):
            remote.seek(0)
            body = remote.read()
            source_archive_sha256 = hashlib.sha256(body).hexdigest()
            document = directory / f'{resource["id"][:8]}-source-documentation.zip'
            document.write_bytes(body)
            with zipfile.ZipFile(document) as check:
                if check.testzip():
                    raise ValueError('Official documentation archive CRC mismatch')
            documents.append(document)
        snapshot = remote.snapshot()
        network, requests = remote.transferred, remote.requests
    inventory = sorted((m.filename, m.file_size, m.CRC) for m in members)
    inventory_sha256 = hashlib.sha256(json.dumps(sorted((m.filename, m.file_size, m.CRC) for m in all_members), ensure_ascii=False).encode()).hexdigest()
    if state.exists():
        result = read_json(state)
        if not members:
            result.update(status='unavailable', availability='empty_source', sourceArchiveSha256=source_archive_sha256, sourceInventorySha256=inventory_sha256, assets=[dict(name=p.name, bytes=p.stat().st_size, sha256=sha256(p)) for p in documents])
        recorded = sorted([(m['name'], m['bytes'], m['crc32']) for m in result['extracted']] +
                          [(m['sourceMember'], m['bytes'], m['crc32']) for m in result['reused']])
        if result['etag'] == version[1] and recorded == inventory and all((directory / a['name']).exists() and sha256(directory / a['name']) == a['sha256'] for a in result['assets']):
            result['selectionVersion'] = 2
            result['inventoryVerified'] = True
            result['sourceInventorySha256'] = inventory_sha256
            write_json(state, result)
            return result, [directory / a['name'] for a in result['assets']]
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
        with NETWORK_SLOTS, RemoteZipFile(resource['url'], snapshot=snapshot) as stream, zipfile.ZipFile(stream) as source, zipfile.ZipFile(partial, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as target:
            for member in names:
                data = source.read(member)  # Read this exact central-directory entry and verify its CRC, including ZIP64.
                target.writestr(member.filename, data)
                records.append(dict(name=member.filename, bytes=len(data), crc32=member.CRC, sha256=hashlib.sha256(data).hexdigest()))
            network, requests = stream.transferred, stream.requests
        partial.replace(output)
        with zipfile.ZipFile(output) as archive:
            if archive.testzip():
                raise ValueError('Output RDV ZIP CRC mismatch')
        return output, records, network, requests
    tasks = [(i, selected[i::STREAMS]) for i in range(min(STREAMS, len(selected)))]
    paths = documents.copy()
    extracted = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=STREAMS) as pool:
        for output, records, transferred, count in pool.map(shard, tasks):
            paths.append(output)
            extracted.extend(records)
            network += transferred
            requests += count
    result = dict(url=resource['url'], etag=version[1], sourceBytes=version[0], retrievedAt=now(),
                  status='prepared' if members else 'unavailable', availability='available' if members else 'empty_source',
                  selectionVersion=2, inventoryVerified=True, sourceInventorySha256=inventory_sha256, sourceArchiveSha256=source_archive_sha256, sourceMemberCount=len(all_members),
                  otherMemberNames=[m.filename for m in all_members] if not members else [], membersAvailable=len(members), membersExtracted=len(extracted), membersReused=len(matched),
                  reused=matched, extracted=extracted, networkBytes=network, requests=requests, elapsedSeconds=round(time.monotonic()-started, 2),
                  assets=[dict(name=p.name, bytes=p.stat().st_size, sha256=sha256(p)) for p in paths])
    write_json(state, result)
    print(json.dumps({k: result[k] for k in ['url', 'membersAvailable', 'membersExtracted', 'membersReused', 'networkBytes', 'elapsedSeconds']}), flush=True)
    return result, paths


def derived_collection(dataset, resources):
    identifier = f'rdv-{dataset["id"]}'
    tag = f'data-{identifier}'
    return dict(id=identifier, title=f'RDV · {dataset["title"]}', groups=dataset['groups'], family='rdv', years=dataset['years'],
                license=dataset['license'], source=dataset['source'], branch=f'archive/{identifier}', tag=tag,
                releaseUrl=f'https://github.com/{REPO}/releases/tag/{tag}', normalized=False, status='downloading',
                resources=resources, inScope=True)


def publish_collection(root, collection, entries, paths):
    # Per-member integrity evidence remains a release asset, not a huge Pages catalogue.
    detail = root / 'releases' / collection['id'] / 'MEMBERS.json'
    write_json(detail, dict(generatedAt=now(), sources=entries))
    compact = [{k: v for k, v in entry.items() if k not in ['extracted', 'reused']} for entry in entries]
    manifest = publish_prepared(root, collection, compact, paths + [detail])
    write_json(root / 'rdv' / f'{collection["id"]}.json', manifest)
    print(f'published {collection["id"]}', flush=True)


def run(root, catalog, reused, selected=None):
    jobs = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as publisher:
        for dataset in catalog['datasets']:
            resources = [r for r in dataset['resources'] if '/arqurnatot/' in r['url'] and r['url'].endswith('.zip')]
            if not resources or selected and dataset['id'] not in selected:
                continue
            collection = derived_collection(dataset, resources)
            entries, paths = [], []
            with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
                for resource, (result, files) in zip(resources, pool.map(lambda r: extract_bundle(root, r, reused), resources)):
                    entries.append({**resource, **result, 'inScope': True})
                    paths.extend(files)
            jobs.append(publisher.submit(publish_collection, root, collection, entries, paths))
        for job in jobs:
            job.result()


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--root', type=pathlib.Path, default=pathlib.Path('.cache/tse-archive'))
    p.add_argument('--dataset', action='append')
    args = p.parse_args()
    run(args.root, read_json(args.root / 'catalog/catalog.json'), existing(args.root), args.dataset)


if __name__ == '__main__':
    main()
