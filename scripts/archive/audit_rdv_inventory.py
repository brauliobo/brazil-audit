#!/usr/bin/env python3
"""Revalidate every selected source inventory without repeating valid RDV payload downloads."""
import argparse
import concurrent.futures
import json
import pathlib
from archive_rdv import existing, extract_bundle
from tse_archive import read_json, write_json, now, command, REPO


def audit(root):
    catalog = read_json(root / 'catalog/catalog.json')
    resources = {r['url']: r for d in catalog['datasets'] for r in d['resources'] if '/arqurnatot/' in r['url'] and r['url'].endswith('.zip')}
    reused = existing(root)
    expected_originals = {r['asset']: r['assetDigest'] for r in reused.values()}
    actual_originals = {}
    for tag in ['data-2022', 'data-2026', 'data-2026-2']:
        data = json.loads(command('gh', 'api', f'repos/{REPO}/releases/tags/{tag}'))
        actual_originals.update({a['browser_download_url']: a.get('digest') for a in data['assets']})
    if any(actual_originals.get(url) != digest for url, digest in expected_originals.items()):
        raise ValueError('An original referenced RDV asset changed since source selection')
    summaries = []
    def check(resource):
        result, paths = extract_bundle(root, resource, reused)
        if result['membersAvailable'] != result['membersExtracted'] + result['membersReused'] or not result['inventoryVerified']:
            raise ValueError('RDV inventory coverage does not reconcile')
        return {k: result.get(k) for k in ['url', 'etag', 'sourceBytes', 'sourceInventorySha256', 'sourceArchiveSha256', 'availability', 'membersAvailable', 'membersExtracted', 'membersReused', 'sourceMemberCount']}
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for result in pool.map(check, resources.values()):
            summaries.append(result)
            print(f'audited {len(summaries)}/{len(resources)} {result["url"]}', flush=True)
    receipt = dict(version=1, checkedAt=now(), resources=len(resources), originalAssetsVerified=len(expected_originals),
                   newMembers=sum(r['membersExtracted'] for r in summaries), referencedMembers=sum(r['membersReused'] for r in summaries),
                   emptySources=sum(r['membersAvailable'] == 0 for r in summaries), sources=summaries)
    write_json(root / 'catalog/final-rdv-inventory.json', receipt)
    return receipt


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=pathlib.Path, default=pathlib.Path('.cache/tse-archive'))
    audit(parser.parse_args().root)
