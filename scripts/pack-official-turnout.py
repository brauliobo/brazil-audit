#!/usr/bin/env python3
"""Archive the exact official JSONs backing a shipped turnout part, with source hashes."""
import argparse
import csv
import gzip
import hashlib
import json
from pathlib import Path
import shutil
import zipfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--election', default='2026-2')
parser.add_argument('--output', required=True)
args = parser.parse_args()
key = args.election
manifest = json.loads(Path('data/manifest.json').read_text())
table = manifest['tables']['turnout']
part = table['parts'][f'{key}/all']
columns = table['columns'].split(',')
with gzip.open(Path('data') / part['url'], 'rt') as f:
    rows = list(csv.DictReader(f, fieldnames=columns))
assert len(rows) == part['rows']
out = Path(args.output)
out.mkdir(parents=True, exist_ok=True)
name = f'{key}-official-turnout.zip'
csv_name = f'{key}-turnout.csv.gz'
metadata_name = f'{key}-turnout-MANIFEST.json'
checksums_name = f'{key}-turnout-SHA256SUMS'
metadata = {
    'election': key,
    'version': manifest['version'],
    'schema': table['ddl'],
    'columns': columns,
    'records': len(rows),
    'scopes': {scope: sum(r['scope'] == scope for r in rows) for scope in ['br', 'uf', 'city', 'zone']},
    'denominator': 'installed = present + absent; electorate = installed + not_installed',
    'grain': 'zone is a municipality-zone pair, not an entire zone spanning multiple municipalities',
    'sources': [],
}
with zipfile.ZipFile(out / name, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
    for r in sorted(rows, key=lambda r: (r['scope'], r['state'], r['code'], r['zone'])):
        stem = r['state'] + r['code'] + (f"-z{r['zone']}" if r['zone'] else '')
        source = Path(f'.cache/turnout-{key}-{stem}.json')
        body = source.read_bytes()
        data = json.loads(body)
        assert int(data['t']) == int(r['turn'])
        assert [int(data['e'][f]) for f in ['te', 'esi', 'esni', 'est', 'esnt', 'c', 'a']] == [int(r[f]) for f in ['electorate', 'installed', 'not_installed', 'totalized', 'uncounted', 'present', 'absent']]
        archive_path = f'sources/{stem}.json'
        archive.writestr(archive_path, body)
        metadata['sources'].append({'path': archive_path, 'url': r['url'], 'generated': r['generated'], 'bytes': len(body), 'sha256': hashlib.sha256(body).hexdigest()})
    config = Path(f'.cache/turnout-{key}-municipalities.json').read_bytes()
    archive.writestr('municipalities.json', config)
    metadata['configuration'] = {'path': 'municipalities.json', 'bytes': len(config), 'sha256': hashlib.sha256(config).hexdigest()}
    archive.writestr('MANIFEST.json', json.dumps(metadata, ensure_ascii=False, indent=1) + '\n')
shutil.copyfile(Path('data') / part['url'], out / csv_name)
(out / metadata_name).write_text(json.dumps(metadata, ensure_ascii=False, indent=1) + '\n')
files = [name, csv_name, metadata_name]
(out / checksums_name).write_text(''.join(f'{hashlib.sha256((out / file).read_bytes()).hexdigest()}  {file}\n' for file in files))
with zipfile.ZipFile(out / name) as archive:
    assert archive.testzip() is None
    assert len(archive.namelist()) == len(rows) + 2
print(json.dumps({'files': files + [checksums_name], 'records': len(rows), 'scopes': metadata['scopes'], 'zip_bytes': (out / name).stat().st_size}))
