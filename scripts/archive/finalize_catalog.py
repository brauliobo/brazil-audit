#!/usr/bin/env python3
"""Attach independently verified RDV collections and normalized summaries to the catalogue."""
import argparse
import pathlib
from tse_archive import read_json, write_json, now


def finalize(root, out):
    catalog = read_json(root / 'catalog/catalog.json')
    index = read_json(out.parent / 'indicators.json')
    catalog['normalizedIndex'] = 'history/indicators.json'
    sources = {}
    for election in index['elections']:
        for source in election['sources']:
            sources.setdefault(source, []).append(election['id'])
    for dataset in catalog['datasets']:
        ids = sorted({eid for resource in dataset['resources'] for eid in sources.get(resource['url'], [])})
        if ids:
            dataset['normalizedSummaries'] = dict(index='history/indicators.json', elections=ids)
    existing = {d['id'] for d in catalog['datasets']}
    for path in sorted((root / 'rdv').glob('rdv-*.json')):
        manifest = read_json(path)
        dataset = manifest['dataset']
        verification = read_json(root / 'releases' / dataset['id'] / 'VERIFIED.json')
        if dataset['id'] not in existing:
            catalog['datasets'].append({**dataset, 'status': manifest['status'], 'publicationVerifiedAt': verification['verifiedAt'],
                                        'normalized': False, 'inScope': True, 'resources': manifest['resources']})
    catalog['generatedAt'] = now()
    write_json(out, catalog)


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--root', type=pathlib.Path, default=pathlib.Path('.cache/tse-archive'))
    p.add_argument('--out', type=pathlib.Path, default=pathlib.Path('data/history/catalog.json'))
    a = p.parse_args()
    finalize(a.root, a.out)
