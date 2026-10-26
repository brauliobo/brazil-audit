#!/usr/bin/env python3
"""Normalize the TSE's historical turnout/result summaries without inventing missing granularity."""
import argparse
import csv
import gzip
import hashlib
import io
import json
import pathlib
import re
import unicodedata
import zipfile
from tse_archive import read_json, write_json, now, sha256

COLUMNS = ['election_id', 'source_election_id', 'year', 'turn', 'description', 'date', 'election_type', 'scope', 'state', 'city_code', 'zone', 'office', 'office_key', 'office_name',
           'eligible', 'installed', 'present', 'absent', 'blank', 'null', 'null_total', 'null_technical', 'annulled', 'annulled_subjudice', 'annulled_separate', 'valid', 'sections', 'not_installed', 'transit', 'source_url', 'source_id', 'source_sha256']
METRIC_DEFINITIONS = {
    'eligible': 'Registered electorate reported by QT_APTOS/QTD_APTOS.',
    'installed': 'Participation denominator; available only when electorate, reported attendance, abstention and uninstalled-section voters reconcile.',
    'null': 'Reported null votes: QT_VOTOS_NULOS/QTD_VOTOS_NULOS.',
    'null_total': 'Distinct official QT_TOTAL_VOTOS_NULOS quantity; retained without assuming equivalence with ordinary null votes.',
    'null_technical': 'Reported QT_VOTOS_NULOS_TECNICOS; distinct technical null votes.',
    'annulled': 'QT_TOTAL_VOTOS_ANULADOS: votes annulled due to the legal status of candidacies or parties.',
    'annulled_subjudice': 'QT_TOTAL_VOTOS_ANUL_SUBJUD: annulled votes under judicial appeal.',
    'annulled_separate': 'QT_VOTOS_ANULADOS_APU_SEP/QTD_VOTOS_ANULADOS_APU_SEP: separately counted votes from urns under judicial review; neither valid nor null pending judgment.',
    'valid': 'Native official JSON v.vv, or QT_TOTAL_VOTOS_VALIDOS only when consistent with nominal and list components; historical votos líquidos are not silently converted.'
}
LEGACY = ['DATA_GERACAO', 'HORA_GERACAO', 'ANO_ELEICAO', 'NUM_TURNO', 'DESC_ELEICAO', 'SIGLA_UF', 'SIGLA_UE', 'COD_CARGO',
          'DESC_CARGO', 'QTD_APTOS', 'QTD_COMPARECIMENTO', 'QTD_ABSTENCOES', 'QTD_VOTOS_LIQUIDOS', 'QTD_VOTOS_BRANCOS',
          'QTD_VOTOS_NULOS', 'QTD_VOTOS_LEGENDA', 'QTD_VOTOS_ANULADOS_APU_SEP', 'QTD_SECOES_TOT', 'QTD_SECOES_ANULADAS',
          'QTD_SECOES_SEM_FUNCION', 'QTD_ZONAS_ELEITORAIS', 'QTD_JUNTAS_APURADORAS']


def number(value):
    if value in [None, '', '#NULO#', '#NE#']:
        return None
    n = int(value)
    return n if n >= 0 else None


def office_key(code, name):
    normalized = ''.join(c for c in unicodedata.normalize('NFD', name.upper()) if not unicodedata.combining(c))
    names = {'PRESIDENTE': 'president', 'GOVERNADOR': 'governor', 'SENADOR': 'senator', 'DEPUTADO FEDERAL': 'federal_deputy',
             'DEPUTADO ESTADUAL': 'state_deputy', 'DEPUTADO DISTRITAL': 'district_deputy', 'PREFEITO': 'mayor', 'VEREADOR': 'councillor'}
    return names.get(normalized, f'historical:{code}:{normalized}')


def normalize(raw, resource):
    def get(*names):
        return next((raw[name] for name in names if raw.get(name) not in [None, '']), None)
    year = number(get('ANO_ELEICAO'))
    turn = number(get('NR_TURNO', 'NUM_TURNO'))
    description = get('DS_ELEICAO', 'DESC_ELEICAO') or ''
    election = get('CD_ELEICAO') or f'legacy-{year}-{hashlib.sha256(description.encode()).hexdigest()[:10]}'
    date = get('DT_ELEICAO') or ''
    event_id = f'{year}:{election}:{turn if turn is not None else "na"}'
    if date:
        event_id += ':' + '-'.join(reversed(date.split('/')))
    city = get('CD_MUNICIPIO')
    zone = number(get('NR_ZONA'))
    city = str(int(city)).zfill(5) if number(city) is not None else ''
    zone = str(zone).zfill(4) if zone is not None else ''
    state = (get('SG_UF', 'SIGLA_UF') or '').lower()
    code = get('CD_CARGO', 'COD_CARGO') or ''
    name = get('DS_CARGO', 'DESC_CARGO') or ''
    # Historical "votos líquidos" is preserved in the original archive. Its meaning is not silently equated to modern valid votes.
    total, nominal, legend = [number(get(k)) for k in ['QT_TOTAL_VOTOS_VALIDOS', 'QT_VOTOS_NOMINAIS_VALIDOS', 'QT_TOTAL_VOTOS_LEG_VALIDOS']]
    valid = total if None not in [total, nominal, legend] and total == nominal + legend else None
    result = dict(election_id=event_id, source_election_id=get('CD_ELEICAO') or '', year=year, turn=turn, description=description,
                  date=date, election_type=get('NM_TIPO_ELEICAO') or '',
                  scope='national' if state == 'br' and not city else 'zone' if zone and city else 'municipality' if city else 'state', state=state, city_code=city, zone=zone,
                  office=code, office_key=office_key(code, name), office_name=name,
                  eligible=number(get('QT_APTOS', 'QTD_APTOS')), present=number(get('QT_COMPARECIMENTO', 'QTD_COMPARECIMENTO')),
                  absent=number(get('QT_ABSTENCOES', 'QTD_ABSTENCOES')), blank=number(get('QT_VOTOS_BRANCOS', 'QTD_VOTOS_BRANCOS')),
                  null=number(get('QT_VOTOS_NULOS', 'QTD_VOTOS_NULOS')), null_total=number(get('QT_TOTAL_VOTOS_NULOS')),
                  null_technical=number(get('QT_VOTOS_NULOS_TECNICOS')), annulled=number(get('QT_TOTAL_VOTOS_ANULADOS')),
                  annulled_subjudice=number(get('QT_TOTAL_VOTOS_ANUL_SUBJUD')), annulled_separate=number(get('QT_VOTOS_ANULADOS_APU_SEP', 'QTD_VOTOS_ANULADOS_APU_SEP')), valid=valid,
                  sections=number(get('QT_TOTAL_SECOES', 'QTD_SECOES_TOT')),
                  not_installed=number(get('QT_ELEITORES_SECOES_NAO_INSTALADAS')),
                  transit=get('ST_VOTO_EM_TRANSITO') or '', source_url=resource['url'], source_id=resource['id'], source_sha256=resource.get('sha256') or '')
    eligible, present, absent, not_installed = [result[k] for k in ['eligible', 'present', 'absent', 'not_installed']]
    result['installed'] = None
    if None not in [eligible, present, absent]:
        if eligible == present + absent:
            result['installed'] = eligible
        elif not_installed is not None and eligible == present + absent + not_installed:
            result['installed'] = eligible - not_installed
    return result


def source_issue(row):
    if None not in [row['eligible'], row['present'], row['absent']] and row['installed'] is None:
        return 'Reported turnout does not reconcile with electorate and known uninstalled sections.'
    return None


METRICS = ['eligible', 'installed', 'present', 'absent', 'blank', 'null', 'null_total', 'null_technical', 'annulled', 'annulled_subjudice', 'annulled_separate', 'valid', 'sections', 'not_installed']


def reconcile(previous, row):
    conflicts = [field for field in METRICS if previous[field] != row[field]]
    merged = previous.copy()
    for field in conflicts:
        merged[field] = None
    return merged, conflicts


def records(path, resource):
    with zipfile.ZipFile(path) as archive:
        for member in archive.namelist():
            if not member.lower().endswith(('.csv', '.txt')):
                continue
            with archive.open(member) as inp:
                text = io.TextIOWrapper(inp, encoding='latin1', newline='')
                reader = csv.reader(text, delimiter=';')
                first = next(reader)
                if 'ANO_ELEICAO' in first:
                    columns = first
                else:
                    if '/detalhe_votacao_uf/' not in resource['url']:
                        raise ValueError(f'Unknown headerless schema: {resource["url"]}:{member}')
                    columns = LEGACY
                    yield normalize(dict(zip(columns, first)), resource)
                for row in reader:
                    if row:
                        if len(row) != len(columns):
                            raise ValueError(f'Column count mismatch: {resource["url"]}:{member}')
                        yield normalize(dict(zip(columns, row)), resource)


IDENTITY = ['election_id', 'scope', 'state', 'city_code', 'zone', 'office', 'transit']


def append_row(elections, row, source_year, ambiguous, source_anchor=True):
    event = elections.setdefault(row['election_id'], dict(id=row['election_id'], year=row['year'], turn=row['turn'],
                                 description=row['description'], rows={}, offices={}, sources=set(), sourceDatasetYears=set()))
    identity = tuple(row[k] for k in IDENTITY)
    if identity in event['rows']:
        previous = event['rows'][identity]
        merged, conflicts = reconcile(previous, row)
        if conflicts:
            ambiguous.append(dict(identity=identity, reason='Conflicting source metrics at the same election/date/grain.', unavailableMetrics=conflicts, records=[previous, row]))
        event['rows'][identity] = merged
    else:
        event['rows'][identity] = row
    event['offices'][row['office_key']] = dict(id=row['office'], key=row['office_key'], name=row['office_name'])
    if source_anchor:
        event['sources'].add(row['source_url'])
    event['sourceDatasetYears'].add(source_year)


def build(root, out):
    catalog = read_json(root / 'catalog/catalog.json')
    out.mkdir(parents=True, exist_ok=True)
    elections = {}
    missing = []
    ambiguous = []
    inconsistent = []
    year_conflicts = {}
    for dataset in catalog['datasets']:
        sources = [r for r in dataset['resources'] if r.get('inScope') and any(k in r['url'] for k in ['/detalhe_votacao_uf/', '/detalhe_votacao_munzona/'])]
        if not sources:
            continue
        collection = {}
        for resource in sources:
            key = hashlib.sha256(resource['url'].encode()).hexdigest()
            path = root / 'downloads' / key / pathlib.PurePosixPath(resource['url']).name
            if not path.exists():
                missing.append(resource['url'])
                continue
            for row in records(path, resource):
                date_year = re.search(r'(\d{4})$', row['date'])
                if date_year and int(date_year.group(1)) != row['year']:
                    year_conflicts[row['election_id']] = dict(electionId=row['election_id'], declaredYear=row['year'], date=row['date'], source=resource['url'])
                issue = source_issue(row)
                if issue:
                    inconsistent.append(dict(reason=issue, record=row.copy(), unavailableMetrics=['installed', 'present', 'absent']))
                    row = {**row, 'installed': None, 'present': None, 'absent': None}
                identity = tuple(row[k] for k in ['election_id', 'scope', 'state', 'city_code', 'zone', 'office', 'transit'])
                if identity in collection:
                    merged, conflicts = reconcile(collection[identity], row)
                    if conflicts:
                        ambiguous.append(dict(identity=identity, source=resource['url'], reason='Conflicting metrics at the same reported grain; only conflicting values are unavailable, original records retained.', unavailableMetrics=conflicts, records=[collection[identity], row]))
                    collection[identity] = merged
                else:
                    collection[identity] = row
        package_year = re.search(r'(?:^|-)((?:19|20)\d{2})(?:-|$)', dataset['id'])
        for row in collection.values():
            append_row(elections, row, int(package_year.group(1)) if package_year else row['year'], ambiguous)
    from official_history import official_rows
    for row, source_year, anchor in official_rows(root, normalize):
        append_row(elections, row, source_year, ambiguous, anchor)
    index = dict(version=1, generatedAt=now(), columns=COLUMNS, metricDefinitions=METRIC_DEFINITIONS, missingSources=missing, ambiguousUnits=len(ambiguous), inconsistentUnits=len(inconsistent), diagnostics='history/diagnostics.json', elections=[])
    write_json(out / 'diagnostics.json', dict(generatedAt=now(), ambiguousUnits=ambiguous, inconsistentUnits=inconsistent, electionYearConflicts=list(year_conflicts.values())))
    for e in sorted(elections.values(), key=lambda e: (e['year'], e['turn'] or 0, e['id'])):
        slug = re.sub(r'[^A-Za-z0-9._-]+', '-', e['id'])
        path = out / f'indicators-{slug}.csv.gz'
        body = io.StringIO(newline='')
        writer = csv.writer(body, lineterminator='\n')
        writer.writerow(COLUMNS)
        for row in e['rows'].values():
            writer.writerow([row[k] for k in COLUMNS])
        encoded = body.getvalue().encode('utf8')
        with path.open('wb') as raw, gzip.GzipFile(filename='', mode='wb', fileobj=raw, mtime=0) as zipped:
            zipped.write(encoded)
        index['elections'].append(dict(id=e['id'], year=e['year'], turn=e['turn'], description=e['description'], dates=sorted({r['date'] for r in e['rows'].values() if r['date']}), electionTypes=sorted({r['election_type'] for r in e['rows'].values() if r['election_type']}), sourceElectionIds=sorted({r['source_election_id'] for r in e['rows'].values() if r['source_election_id']}), sourceDatasetYears=sorted(e['sourceDatasetYears']), yearDateConflict=e['id'] in year_conflicts,
            parts=[dict(url=f'history/{path.name}', rows=len(e['rows']), bytes=path.stat().st_size, rawBytes=len(encoded), sha256=sha256(path),
                        scopes=sorted({r['scope'] for r in e['rows'].values()}))], offices=list(e['offices'].values()), sources=sorted(e['sources'])))
    write_json(out / 'indicators.json', index)
    print(json.dumps(dict(elections=len(index['elections']), rows=sum(p['rows'] for e in index['elections'] for p in e['parts']), missingSources=len(missing))), flush=True)


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--root', type=pathlib.Path, default=pathlib.Path('.cache/tse-archive'))
    p.add_argument('--out', type=pathlib.Path, default=pathlib.Path('data/history'))
    a = p.parse_args()
    build(a.root, a.out)
