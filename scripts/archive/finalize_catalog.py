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
            complete = all(r.get('selectionVersion') == 2 and r['membersAvailable'] == r['membersExtracted'] + r['membersReused'] for r in manifest['resources'])
            status = manifest['status'] if complete else 'partial'
            clean = {k: v for k, v in dataset.items() if k not in ['publicationVerifiedAt', 'releaseUrl', 'status']}
            clean.update(releaseUrl=f'https://github.com/brauliobo/brazil-audit/releases/tag/{dataset["tag"]}', status=status,
                         normalized=False, inScope=True, family='rdv', resources=[{**r, 'inScope': True, 'status': ('published' if r['status'] == 'prepared' else r['status']) if complete else 'partial'} for r in manifest['resources']])
            if complete:
                clean['publicationVerifiedAt'] = verification['verifiedAt']
            catalog['datasets'].append(clean)
    for path in sorted((root / 'official-published').glob('*.json')):
        manifest = read_json(path)
        dataset = manifest['dataset']
        verification = read_json(root / 'releases' / dataset['id'] / 'VERIFIED.json')
        dataset = {**dataset, 'status': manifest['status'], 'publicationVerifiedAt': verification['verifiedAt'],
                   'resources': [{**r, 'status': 'published' if r['status'] == 'prepared' else r['status']} for r in manifest['resources']]}
        ids = sorted({eid for resource in dataset['resources'] for eid in sources.get(resource['url'], [])})
        if ids:
            dataset['normalizedSummaries'] = dict(index='history/indicators.json', elections=ids)
        catalog['datasets'].append(dataset)
    basic = [d for d in catalog['datasets'] if d.get('inScope') and not d['id'].startswith('rdv-') and d.get('sourceType', 'ckan') == 'ckan']
    bundles = [dict(id=d['id'], resources=sum('/arqurnatot/' in r['url'] and r['url'].endswith('.zip') for r in d['resources'])) for d in catalog['datasets'] if not d['id'].startswith('rdv-')]
    bundles = [d for d in bundles if d['resources']]
    verified = [read_json(root / 'releases' / d['id'] / 'VERIFIED.json') for d in basic if d['status'] == 'published']
    write_json(out.parent / 'coverage.json', dict(generatedAt=now(),
        basic=dict(collections=len(basic), published=sum(d['status'] == 'published' for d in basic), assets=sum(v['assets'] for v in verified), publishedBytes=sum(v['bytes'] for v in verified)),
        historical=dict(elections=len(index['elections']), declaredYears=sorted({e['year'] for e in index['elections']}), rows=sum(p['rows'] for e in index['elections'] for p in e['parts']), missingSources=index['missingSources']),
        rdv=dict(documentedBundles=sum(d['resources'] for d in bundles), collections=bundles,
                 publishedCollections=sum(d['id'].startswith('rdv-') and d['status'] == 'published' for d in catalog['datasets']),
                 scope='Public RDV download sources documented by the official CKAN catalogue. Historical legal existence of RDV does not establish a public bulk download URL.',
                 historicalAccessReference='https://www.tse.jus.br/legislacao/compilada/res/2013/resolucao-no-23-397-de-17-de-dezembro-de-2013')))
    catalog['datasetCount'] = len(catalog['datasets'])
    catalog['resourceCount'] = sum(len(d['resources']) for d in catalog['datasets'])
    catalog['uniqueUrlCount'] = len({r['url'] for d in catalog['datasets'] for r in d['resources']})
    catalog['inScopeUniqueResourceCount'] = len({r['url'] for d in catalog['datasets'] if d.get('inScope') for r in d['resources'] if r.get('inScope')})
    catalog['inScopeDatasetCount'] = sum(bool(d.get('inScope')) for d in catalog['datasets'])
    catalog['generatedAt'] = now()
    write_json(out, catalog)


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--root', type=pathlib.Path, default=pathlib.Path('.cache/tse-archive'))
    p.add_argument('--out', type=pathlib.Path, default=pathlib.Path('data/history/catalog.json'))
    a = p.parse_args()
    finalize(a.root, a.out)
