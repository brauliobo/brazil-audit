#!/usr/bin/env python3
"""Align this archive's own data tags with verified branch manifests; leave source assets unchanged."""
import argparse
import hashlib
import json
import pathlib
import subprocess
from tse_archive import GIT, REPO, command, now, read_json, write_json, sha256, resource_complete

RESERVED = {'data-2018', 'data-2022', 'data-2026', 'data-2026-2'}


def owned_identity(manifest, allowed):
    dataset = manifest['dataset']
    identifier = dataset['id']
    tag, branch = dataset['tag'], dataset['branch']
    if identifier not in allowed or tag in RESERVED or tag != f'data-{identifier}' or branch != f'archive/{identifier}':
        raise ValueError('Refusing to modify a tag outside this task-owned archive namespace')
    return identifier, tag, branch


def publication_complete(manifest):
    # The first schema-v1 snapshots did not have an operation-level status.
    # Read their explicit resource states and still require full remote asset verification.
    return manifest.get('status') in [None, 'published'] and all(resource_complete(row) for row in manifest['resources'])


def verify_assets(directory, manifest, verification, assets):
    expected = {}
    sizes = {a['name']: a['bytes'] for r in manifest['resources'] for a in r.get('assets', [])}
    for line in (directory / 'SHA256SUMS').read_text().splitlines():
        digest, separator, name = line.partition('  ')
        if not separator or len(digest) != 64:
            raise ValueError('Invalid published checksum manifest')
        size = sizes[name] if name in sizes else (directory / name).stat().st_size
        expected[name] = dict(bytes=size, sha256=digest)
    for name in ['ARCHIVE.json', 'README.md', 'SHA256SUMS']:
        path = directory / name
        expected[name] = dict(bytes=path.stat().st_size, sha256=sha256(path))
    actual = {a['name']: dict(bytes=a['size'], sha256=(a.get('digest') or '').removeprefix('sha256:')) for a in assets}
    if expected != actual or len(actual) != verification['assets'] or sum(a['bytes'] for a in actual.values()) != verification['bytes']:
        raise ValueError('Remote asset set, bytes or SHA differs from the verified publication')
    digest = hashlib.sha256(json.dumps(actual, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    return digest


def synchronize(root):
    catalog = read_json(root / 'catalog/catalog.json')
    allowed = {d['id'] for d in catalog['datasets'] if d.get('inScope')}
    for folder in ['rdv', 'official-published']:
        allowed.update(read_json(p)['dataset']['id'] for p in (root / folder).glob('*.json') if 'dataset' in read_json(p))
    receipt_path = root / 'catalog/release-verification.json'
    receipt = read_json(receipt_path) if receipt_path.exists() else dict(generatedAt=now(), publications=[])
    previous = {row['tag']: row for row in receipt['publications']}
    for directory in sorted((root / 'releases').iterdir()):
        if not (directory / 'VERIFIED.json').exists() or directory.name not in allowed:
            continue
        manifest = read_json(directory / 'ARCHIVE.json')
        identifier, tag, branch = owned_identity(manifest, allowed)
        verification = read_json(directory / 'VERIFIED.json')
        if not publication_complete(manifest):
            raise ValueError('Cannot finalize tags for an incomplete publication')
        branch_row = command('git', 'ls-remote', '--heads', GIT, f'refs/heads/{branch}')
        new = branch_row.split()[0]
        if new != verification['commit']:
            raise ValueError('Branch advanced beyond its verified publication')
        commit_manifest = subprocess.check_output(['git', 'show', f'{new}:ARCHIVE.json'])
        manifest_sha = sha256(directory / 'ARCHIVE.json')
        if hashlib.sha256(commit_manifest).hexdigest() != manifest_sha:
            raise ValueError('Branch and verified archive manifest differ')
        api = command('gh', 'release', 'view', tag, '-R', REPO, '--json', 'apiUrl', '--jq', '.apiUrl')
        release = json.loads(command('gh', 'api', api))
        if release['draft']:
            raise ValueError('Verified release is not public')
        assets_before = verify_assets(directory, manifest, verification, release['assets'])
        old = command('git', 'ls-remote', '--tags', GIT, f'refs/tags/{tag}').split()[0]
        prior = previous.get(tag)
        if prior and (prior['verifiedCommit'] != new or prior['manifestSha256'] != manifest_sha or prior['assetSetSha256'] != assets_before):
            raise ValueError('Publication changed after final tag audit began')
        row = prior or dict(id=identifier, tag=tag, branch=branch, oldCommit=old, verifiedCommit=new,
            manifestSha256=manifest_sha, assetSetSha256=assets_before, assets=verification['assets'], bytes=verification['bytes'],
            tagChanged=old != new, assetsUnchanged=False, status='planned', releaseUrl=f'https://github.com/{REPO}/releases/tag/{tag}')
        if not prior:
            receipt['publications'].append(row)
            previous[tag] = row
        write_json(receipt_path, receipt)
        if old != new:
            subprocess.run(['git', 'merge-base', '--is-ancestor', old, new], check=True)
            subprocess.run(['git', 'push', f'--force-with-lease=refs/tags/{tag}:{old}', GIT, f'{new}:refs/tags/{tag}'], check=True)
            assets_after = verify_assets(directory, manifest, verification, json.loads(command('gh', 'api', api))['assets'])
            if assets_after != assets_before:
                raise ValueError('Asset bytes changed during tag-only correction')
        target = command('git', 'ls-remote', '--tags', GIT, f'refs/tags/{tag}').split()[0]
        if target != new:
            raise ValueError('Tag does not identify the verified branch commit')
        verification.update(manifestSha256=manifest_sha, assetSetSha256=assets_before)
        write_json(directory / 'VERIFIED.json', verification)
        row.update(status='verified', assetsUnchanged=True, checkedAt=now())
        write_json(receipt_path, receipt)
        print(f'verified tag/branch/assets {identifier}', flush=True)
    return receipt


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=pathlib.Path, default=pathlib.Path('.cache/tse-archive'))
    synchronize(parser.parse_args().root)
