#!/usr/bin/env python3
"""Publish audited RDV selections without changing frozen releases or fetching source payloads."""
import argparse
import hashlib
import pathlib
from archive_rdv import derived_collection, publish_collection
from tse_archive import read_json, sha256


def publish(root):
    catalog = read_json(root / 'catalog/catalog.json')
    audit = read_json(root / 'catalog/final-rdv-inventory.json')
    audited = {r['url']: r for r in audit['sources']}
    for dataset in catalog['datasets']:
        resources = [r for r in dataset['resources'] if '/arqurnatot/' in r['url'] and r['url'].endswith('.zip')]
        if not resources:
            continue
        collection = derived_collection(dataset, resources)
        verified = root / 'releases' / collection['id'] / 'VERIFIED.json'
        if verified.exists():
            print(f'preserved frozen publication {collection["id"]}', flush=True)
            continue
        entries, paths = [], []
        for resource in resources:
            directory = root / 'rdv' / hashlib.sha256(resource['url'].encode()).hexdigest()
            state = read_json(directory / 'VERIFIED.json')
            proof = audited[resource['url']]
            if state['etag'] != proof['etag'] or state['sourceInventorySha256'] != proof['sourceInventorySha256'] or state['membersAvailable'] != proof['membersAvailable']:
                raise ValueError('Cached source changed after final inventory audit')
            if state['membersAvailable'] != state['membersExtracted'] + state['membersReused']:
                raise ValueError('Cached source inventory is incomplete')
            for asset in state['assets']:
                path = directory / asset['name']
                if path.stat().st_size != asset['bytes'] or sha256(path) != asset['sha256']:
                    raise ValueError('Cached publication asset changed after verification')
                paths.append(path)
            entries.append({**resource, **state, 'inScope': True})
        publish_collection(root, collection, entries, paths)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=pathlib.Path, default=pathlib.Path('.cache/tse-archive'))
    publish(parser.parse_args().root)
