#!/usr/bin/env python3
"""Normalize complete public demographic cells and their disjoint state rollups."""
import argparse
import csv
import gzip
import hashlib
import io
import json
import time
import zipfile
from collections import defaultdict
from datetime import datetime
from pathlib import Path

from tse_archive import read_json, write_json, sha256

AXES = {
    'gender': ('GENERO',), 'marital_status': ('ESTADO_CIVIL',), 'age': ('FAIXA_ETARIA',),
    'education': ('GRAU_ESCOLARIDADE', 'GRAU_INSTRUCAO'), 'race': ('RACA_COR', 'COR_RACA'),
    'gender_identity': ('IDENTIDADE_GENERO',), 'quilombola': ('QUILOMBOLA',), 'libras': ('INTERPRETE_LIBRAS',),
    'indigenous_language': ('IDIOMA_INDIGENA',), 'indigenous_group': ('GRUPO_INDIGENA',),
    'quilombola_language': ('IDIOMA_QUILOMBOLA',), 'biometric_status': ('MUN_SIT_BIOMETRICA',),
}
METRICS = {
    'eligible': ('QT_ELEITORES_PERFIL', 'QT_ELEITORES', 'QT_APTOS'),
    'present': ('QT_COMPARECIMENTO',), 'absent': ('QT_ABSTENCAO',),
    'biometric': ('QT_ELEITORES_BIOMETRIA',), 'disability': ('QT_ELEITORES_DEFICIENCIA',),
    'social_name': ('QT_ELEITORES_INC_NM_SOCIAL', 'QT_ELEITORES_NOME_SOCIAL'),
    'present_disability': ('QT_COMPARECIMENTO_DEFICIENCIA',), 'absent_disability': ('QT_ABSTENCAO_DEFICIENCIA',),
    'present_transfer': ('QT_COMPARECIMENTO_TTE',), 'absent_transfer': ('QT_ABSTENCAO_TTE',),
    'present_optional': ('QT_COMPAREC_FACULTATIVO',), 'absent_optional': ('QT_ABST_FACULTATIVO',),
    'present_mandatory': ('QT_COMPAREC_OBRIGATORIO',), 'absent_mandatory': ('QT_ABST_OBRIGATORIO',),
    'present_disability_optional': ('QT_COMPAREC_DEFIC_FACULTATIVO',),
    'absent_disability_optional': ('QT_ABST_DEFIC_FACULTATIVO',),
    'present_disability_mandatory': ('QT_COMPAREC_DEFIC_OBRIGATORIO',),
    'absent_disability_mandatory': ('QT_ABST_DEFIC_OBRIGATORIO',),
}
DIMENSION_FIELDS = [name for axis in AXES for name in [axis + '_code', axis]] + ['vote_obligation']
BASE_FIELDS = ['dataset_id', 'kind', 'year', 'turn', 'level', 'grain', 'state', 'city_code', 'city_name', 'zone', 'source_zone',
               'generated_date', 'generated_time']
FIELDS = BASE_FIELDS + DIMENSION_FIELDS + list(METRICS) + ['metric_sentinels', 'source_url', 'source_sha256']


def schema(parts):
    types = {k: 'text' for k in FIELDS}; types.update({k: 'bigint' for k in METRICS})
    types.update(year='int', turn='int', generated_date='date', metric_sentinels='jsonb')
    return dict(name='election_profiles', columns=','.join(FIELDS),
                ddl='create table election_profiles (' + ', '.join(f'{k} {types[k]}' for k in FIELDS) + ')', parts=parts)


def profile_sources(catalog):
    selected = []
    for d in catalog['datasets']:
        if not d.get('inScope') or not (d['id'].startswith('eleitorado-') or d['id'].startswith('comparecimento-e-abstencao-')):
            continue
        for r in d['resources']:
            if r.get('inScope') and any(p in r['url'] for p in ['/perfil_eleitorado/perfil_', '/perfil_comparecimento_abstencao/']):
                selected.append(dict(dataset_id=d['id'], kind='electorate' if d['id'].startswith('eleitorado-') else 'attendance', resource=r))
    return selected


def canonical_members(archive):
    members = [i for i in archive.infolist() if i.filename.lower().endswith('.csv')]
    national = [i for i in members if Path(i.filename).stem.upper().endswith('_BRASIL')]
    if len(national) > 1:
        raise ValueError('multiple national demographic snapshots')
    # BRASIL is the TSE's nationwide cell file, not an additional territory.
    # Its rows retain SG_UF/CD_MUNICIPIO/NR_ZONA. UF copies must not be added.
    return national or members


def mapping(headers):
    def index(*names):
        found = [headers.index(n) for n in names if n in headers]
        if len(found) > 1:
            raise ValueError(f'ambiguous profile aliases: {names}')
        return found[0] if found else None
    mapped = {
        'year': index('ANO_ELEICAO', 'AA_ELEICAO'), 'turn': index('NR_TURNO'), 'state': index('SG_UF'),
        'city_code': index('CD_MUNICIPIO'), 'city_name': index('NM_MUNICIPIO'), 'zone': index('NR_ZONA'),
        'generated_date': index('DT_GERACAO'), 'generated_time': index('HH_GERACAO'),
        'vote_obligation': index('TP_OBRIGATORIEDADE_VOTO'),
    }
    for axis, aliases in AXES.items():
        mapped[axis + '_code'] = index(*('CD_' + a for a in aliases))
        mapped[axis] = index(*('DS_' + a for a in aliases))
    for metric, aliases in METRICS.items():
        mapped[metric] = index(*aliases)
    used = {i for i in mapped.values() if i is not None}
    unknown = [h for i, h in enumerate(headers) if i not in used]
    if unknown:
        raise ValueError(f'unmapped demographic fields: {unknown}')
    for required in ['year', 'state', 'city_code', 'eligible']:
        if mapped[required] is None:
            raise ValueError(f'missing demographic field: {required}')
    return mapped


def transform(values, mapped, source, digest):
    def get(field):
        position = mapped.get(field)
        return values[position] if position is not None and values[position] != '' else None
    row = {k: get(k) for k in DIMENSION_FIELDS}
    zone = get('zone'); normalized_zone = str(int(zone)).zfill(4) if zone is not None and int(zone) >= 0 else None
    city = get('city_code'); normalized_city = str(int(city)).zfill(5) if city is not None and int(city) >= 0 else None
    row.update(dataset_id=source['dataset_id'], kind=source['kind'], year=int(get('year')), level='detail',
        turn=int(get('turn')) if get('turn') is not None and int(get('turn')) >= 0 else None,
        grain='zone' if normalized_zone and normalized_city else 'municipality' if normalized_city else 'state',
        state=get('state').lower(), city_code=normalized_city, city_name=get('city_name'), zone=normalized_zone,
        source_zone=zone, generated_date=datetime.strptime(get('generated_date'), '%d/%m/%Y').date().isoformat() if get('generated_date') else None,
        generated_time=get('generated_time'), source_url=source['resource']['url'], source_sha256=digest)
    sentinels = {}
    for metric in METRICS:
        value = get(metric); numeric = int(value) if value is not None else None
        if numeric is not None and numeric < 0:
            sentinels[metric] = numeric; numeric = None
        row[metric] = numeric
    row['metric_sentinels'] = json.dumps(sentinels, separators=(',', ':')) if sentinels else None
    return row


def aggregate(group, row):
    if group is None:
        result = row.copy(); result.update(level='state', grain='state', city_code=None, city_name=None, zone=None, source_zone=None)
        return result
    for metric in METRICS:
        group[metric] = group[metric] + row[metric] if group[metric] is not None and row[metric] is not None else None
    if row['metric_sentinels']:
        values = json.loads(group['metric_sentinels'] or '{}'); values.update(json.loads(row['metric_sentinels']))
        group['metric_sentinels'] = json.dumps(values, separators=(',', ':'))
    return group


class PartWriter:
    def __init__(self, path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path; self.rows = 0
        self.raw = path.open('wb'); self.zipped = gzip.GzipFile(fileobj=self.raw, mode='wb', filename='', mtime=0, compresslevel=6)
        self.text = io.TextIOWrapper(self.zipped, encoding='utf8', newline='')
        self.writer = csv.DictWriter(self.text, FIELDS, lineterminator='\n')

    def write(self, row):
        self.writer.writerow(row); self.rows += 1

    def close(self):
        self.text.flush(); raw_bytes = self.zipped.tell(); self.text.close(); self.raw.close()
        return dict(rows=self.rows, bytes=self.path.stat().st_size, rawBytes=raw_bytes, sha256=sha256(self.path))


def normalize_source(root, output, source, member_name=None, limit=None):
    started = time.monotonic(); resource = source['resource']
    path = root / 'downloads' / hashlib.sha256(resource['url'].encode()).hexdigest() / Path(resource['url']).name
    digest = sha256(path)
    if resource.get('sha256') and resource['sha256'] != digest:
        raise ValueError('profile source digest changed')
    destination = output / source['dataset_id']; destination.mkdir(parents=True, exist_ok=True)
    receipt = destination / 'index.json'
    if receipt.exists() and not member_name and not limit:
        cached = read_json(receipt)
        if cached.get('sourceSha256') == digest and cached.get('normalizerVersion') == 1:
            for p in cached['parts'].values():
                file = output / p['localFile']
                if not file.exists() or sha256(file) != p['sha256']:
                    raise ValueError('cached normalized profile digest mismatch')
            return cached
    writers = {}; groups = defaultdict(dict); detail_grains = defaultdict(set)
    metadata = []; rows = 0; seen = set(); years = set(); turns = set(); axes = set(); available_metrics = set()
    with zipfile.ZipFile(path) as archive:
        members = [archive.getinfo(member_name)] if member_name else canonical_members(archive)
        for member in members:
            with archive.open(member) as stream:
                reader = csv.reader(io.TextIOWrapper(stream, encoding='cp1252', newline=''), delimiter=';')
                headers = next(reader); mapped = mapping(headers)
                axes.update(k for k in AXES if mapped[k] is not None or mapped[k + '_code'] is not None)
                if mapped['vote_obligation'] is not None: axes.add('vote_obligation')
                available_metrics.update(k for k in METRICS if mapped[k] is not None)
                member_rows = 0
                for values in reader:
                    if len(values) != len(headers): raise ValueError('demographic column count mismatch')
                    row = transform(values, mapped, source, digest); state = row['state']; seen.add(state); years.add(row['year']); turns.add(row['turn'])
                    detail_grains[state].add(row['grain'])
                    if state not in writers: writers[state] = PartWriter(destination / f'{state}.detail.csv.gz')
                    writers[state].write(row)
                    identity = (row['year'], row['turn'], row['generated_date'], row['generated_time'], *(row[k] for k in DIMENSION_FIELDS))
                    groups[state][identity] = aggregate(groups[state].get(identity), row)
                    rows += 1; member_rows += 1
                    if limit and rows >= limit: break
                metadata.append(dict(name=member.filename, crc32=f'{member.CRC:08x}', bytes=member.file_size, rows=member_rows,
                                     sourceColumns=headers, columnMapping={key: headers[index] for key, index in mapped.items() if index is not None}))
            if limit and rows >= limit: break
    parts = {}
    for state, writer in writers.items():
        name = f'{source["dataset_id"]}/{state}.detail.csv.gz'; info = writer.close()
        parts[f'{source["dataset_id"]}/{state}.detail'] = dict(info, localFile=name, state=state, level='detail', grains=sorted(detail_grains[state]))
        rollup = PartWriter(destination / f'{state}.state.csv.gz')
        for row in groups[state].values(): rollup.write(row)
        name = f'{source["dataset_id"]}/{state}.state.csv.gz'; info = rollup.close()
        parts[f'{source["dataset_id"]}/{state}.state'] = dict(info, localFile=name, state=state, level='state', grains=['state'])
    result = dict(normalizerVersion=1, datasetId=source['dataset_id'], kind=source['kind'], sourceUrl=resource['url'], sourceSha256=digest,
        years=sorted(years), turns=sorted(turns, key=lambda x: x or 0), axes=sorted(axes), metrics=sorted(available_metrics),
        rows=rows, elapsedSeconds=round(time.monotonic()-started, 2), selectedMembers=metadata,
        selection='national-brasil-cells' if any('BRASIL' in m['name'] for m in metadata) else 'all-csv-members',
        complete=not member_name and not limit, parts=parts)
    write_json(receipt, result)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--root', type=Path, default=Path('.cache/tse-archive'))
    parser.add_argument('--output', type=Path, default=Path('.cache/election-profiles')); parser.add_argument('--dataset')
    parser.add_argument('--member'); parser.add_argument('--limit', type=int); parser.add_argument('--workers', type=int, default=1)
    args = parser.parse_args(); sources = profile_sources(read_json(args.root / 'catalog/catalog.json'))
    selected = [source for source in sources if not args.dataset or source['dataset_id'] == args.dataset]
    def report(result):
        print(json.dumps({k: result[k] for k in ['datasetId', 'rows', 'elapsedSeconds', 'complete']}), flush=True)
    if args.workers == 1:
        for source in selected: report(normalize_source(args.root, args.output, source, args.member, args.limit))
    else:
        from concurrent.futures import ProcessPoolExecutor, as_completed
        with ProcessPoolExecutor(max_workers=min(args.workers, 4)) as pool:
            futures = [pool.submit(normalize_source, args.root, args.output, source, args.member, args.limit) for source in selected]
            for future in as_completed(futures): report(future.result())
