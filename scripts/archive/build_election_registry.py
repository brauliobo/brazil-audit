#!/usr/bin/env python3
"""Build one source-backed election registry and browser-queryable electoral units."""
import argparse
import csv
import gzip
import hashlib
import io
import json
from collections import defaultdict
from datetime import datetime
from pathlib import Path

from normalize_history import METRICS
from tse_archive import read_json, write_json

MODERN_EVENTS = {
    '2018': ['295', '297'], '2018-2': ['296', '298'],
    '2022': ['544', '546'], '2022-2': ['545', '547'],
    '2026': ['6257', '6259'], '2026-2': ['6258', '6260'],
}
GENERAL = {'president', 'governor', 'senator', 'federal_deputy', 'state_deputy', 'district_deputy'}
MUNICIPAL = {'mayor', 'councillor'}
HISTORICAL_STATES = {
    'gb': {'name': 'Guanabara', 'historical': True},
    'gp': {'name': 'Guaporé', 'historical': True},
    'rb': {'name': 'Rio Branco', 'historical': True},
    'vt': {'name': 'VT (código original da fonte)', 'historical': False, 'unresolved': True},
}
# Native null votes are named explicitly: NULL remains the SQL missing-value marker.
UNIT_FIELDS = ['session_key', 'election_id', 'year', 'source_year', 'turn', 'date', 'description', 'election_type',
               'grain', 'state', 'city_code', 'zone', 'section', 'office', 'office_key', 'office_name',
               *[('null_votes' if k == 'null' else k) for k in METRICS], 'transit', 'source_url', 'source_id', 'source_sha256']
NUMERIC = set(METRICS) | {'null_votes'}


def iso_date(value):
    return datetime.strptime(value, '%d/%m/%Y').date().isoformat() if value else None


def event_family(event):
    keys = {o['key'] for o in event['offices']}
    if any('Extraordin' in t or 'Suplementar' in t for t in event['electionTypes']):
        return 'supplementary'
    if keys and keys <= GENERAL:
        return 'general'
    if keys and keys <= MUNICIPAL:
        return 'municipal'
    return 'historical'


def session_groups(events):
    """Only join disjoint general-office events; never coalesce unrelated dated elections."""
    groups = defaultdict(list)
    modern = {}
    for key, codes in MODERN_EVENTS.items():
        year = int(key[:4]); turn = 2 if key.endswith('-2') else 1
        for code in codes:
            modern[(year, turn, code)] = key
    for event in events:
        codes = event['sourceElectionIds']
        alias = modern.get((event['year'], event['turn'], codes[0])) if len(codes) == 1 else None
        dates = [iso_date(d) for d in event['dates']]
        if len(dates) > 1:
            raise ValueError(f"event contains distinct election dates: {event['id']}")
        if alias:
            key = ('modern', alias)
        elif dates and event_family(event) == 'general' and event['electionTypes'] == ['Eleição Ordinária']:
            key = ('general', dates[0], event['turn'])
        else:
            key = ('event', event['id'])
        groups[key].append(event)
    result = []
    for grouping, members in groups.items():
        if grouping[0] == 'general' and len(members) > 1:
            offices = [o['key'] for e in members for o in e['offices']]
            if len(offices) != len(set(offices)):
                # Distinct events contesting the same office remain independently addressable.
                result.extend((f"e-{e['id'].replace(':', '-')}", [e], None) for e in members)
                continue
        if grouping[0] == 'modern':
            key = grouping[1]; legacy = key
        elif grouping[0] == 'general':
            key = f"{grouping[1]}-general-r{grouping[2] if grouping[2] is not None else 'na'}"; legacy = None
        else:
            key = f"e-{members[0]['id'].replace(':', '-')}"; legacy = None
        result.append((key, members, legacy))
    # A unique ordinary/legacy pleito has a short year URL. Extra elections keep
    # their dated source identity, even when held in that same calendar year.
    primary = defaultdict(list)
    for index, (key, members, legacy) in enumerate(result):
        if event_family(members[0]) == 'supplementary':
            continue
        e = members[0]; year = int(iso_date(e['dates'][0])[:4]) if e['dates'] else e['year']
        primary[(year, e['turn'])].append(index)
    for (year, turn), indices in primary.items():
        preferred = [i for i in indices if event_family(result[i][1][0]) in ['general', 'municipal']]
        choices = preferred or indices
        if len(choices) == 1:
            i = choices[0]; _, members, legacy = result[i]
            short = str(year) if turn in [None, 1] else f'{year}-{turn}'
            result[i] = (short, members, legacy)
    return result


def unit_row(row, session):
    result = {k: row.get(k) or None for k in UNIT_FIELDS}
    date = iso_date(row['date'])
    result.update(session_key=session['key'], year=int(date[:4]) if date else int(row['year']), source_year=int(row['year']),
                  turn=int(row['turn']) if row['turn'] else None, date=date, grain=row['scope'], section=None,
                  null_votes=row.get('null') or None)
    for name in NUMERIC:
        if name in result:
            result[name] = int(result[name]) if result[name] is not None else None
    return result


def table_definition(parts):
    types = {k: 'bigint' if k in NUMERIC else 'text' for k in UNIT_FIELDS}
    types.update(year='int', source_year='int', turn='int', date='date')
    return dict(name='election_units', columns=','.join(UNIT_FIELDS),
                ddl='create table election_units (' + ', '.join(f'{k} {types[k]}' for k in UNIT_FIELDS) + ')', parts=parts)


def write_part(path, rows):
    buffer = io.StringIO(newline=''); writer = csv.DictWriter(buffer, UNIT_FIELDS, lineterminator='\n')
    writer.writerows(rows); raw = buffer.getvalue().encode()
    packed = gzip.compress(raw, mtime=0); path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(packed)
    return dict(bytes=len(packed), rawBytes=len(raw), rows=len(rows), sha256=hashlib.sha256(packed).hexdigest())


def build(data_dir):
    index = read_json(data_dir / 'history/indicators.json')
    manifest_path = data_dir / 'manifest.json'; manifest = read_json(manifest_path)
    previous_paths = {p['url'] for p in manifest['tables'].get('election_units', {}).get('parts', {}).values()}
    state_events = set()
    state_table = manifest['tables'].get('state_rounds')
    if state_table:
        for part in state_table['parts'].values():
            with gzip.open(data_dir / part['url'], 'rt', newline='') as stream:
                for values in csv.reader(stream):
                    row = dict(zip(state_table['columns'].split(','), values))
                    state_events.add((row['election_id'], row['office']))
    sessions = []; event_sessions = {}; bindings = []
    for key, events, legacy in session_groups(index['elections']):
        dates = sorted({iso_date(d) for e in events for d in e['dates']})
        if len(dates) > 1:
            raise ValueError(f'session contains distinct dates: {key}')
        years = sorted({e['year'] for e in events}); date = dates[0] if dates else None
        offices = {}
        for e in events:
            if e['id'] in event_sessions:
                raise ValueError(f"duplicate event: {e['id']}")
            event_sessions[e['id']] = key
            for o in e['offices']:
                offices[o['key']] = dict(o, capabilities={'metrics': {}, 'grains': [], 'states': [], 'tables': ['election_units'],
                                                          'sectionResults': False, 'browserRdv': False, 'times': False})
                sources = {'units': dict(table='election_units', election_id=e['id'])}
                if (e['id'], o['id']) in state_events:
                    sources['stateFacts'] = dict(table='state_rounds', election_id=e['id'])
                bindings.append(dict(session_key=key, election_id=e['id'], office_key=o['key'], sources=sources))
        descriptions = list(dict.fromkeys(e['description'] for e in events if e['description']))
        session = dict(key=key, year=int(date[:4]) if date else years[0], calendarYear=int(date[:4]) if date else None,
                       declaredYears=years, sourceYears=sorted({y for e in events for y in e['sourceDatasetYears']}),
                       date=date, turn=events[0]['turn'], family=event_family(events[0]),
                       description=' / '.join(descriptions), label=' / '.join(descriptions) or key,
                       legacyKey=legacy, eventIds=[e['id'] for e in events], offices=list(offices.values()))
        sessions.append(session)
    by_key = {s['key']: s for s in sessions}; grouped = defaultdict(list)
    office_stats = {}
    events_out = []
    for e in index['elections']:
        session = by_key[event_sessions[e['id']]]
        states = set(); scopes = set()
        for part in e['parts']:
            path = data_dir / part['url']; body = path.read_bytes()
            if hashlib.sha256(body).hexdigest() != part['sha256']:
                raise ValueError(f"source part digest mismatch: {part['url']}")
            rows = list(csv.DictReader(io.StringIO(gzip.decompress(body).decode())))
            if len(rows) != part['rows']:
                raise ValueError(f"source part rows mismatch: {part['url']}")
            for row in rows:
                fact = unit_row(row, session); state = fact['state']; office = fact['office_key']
                grouped[(session['key'], state)].append(fact); states.add(state); scopes.add(fact['grain'])
                stats = office_stats.setdefault((session['key'], office), dict(rows=0, grains=set(), states=set(), metrics=defaultdict(int)))
                stats['rows'] += 1; stats['grains'].add(fact['grain']); stats['states'].add(state)
                for k in METRICS:
                    name = 'null_votes' if k == 'null' else k
                    if fact[name] is not None:
                        stats['metrics'][name] += 1
        events_out.append(dict(e, session_key=session['key'], states=sorted(states), grains=sorted(scopes)))
    parts = {}
    for (key, state), rows in sorted(grouped.items()):
        relative = f'election-units/{key}/{state}.csv.gz'
        metadata = write_part(data_dir / relative, rows)
        # Each COPY replaces exactly one disjoint session/UF partition.
        escaped_key = key.replace("'", "''"); escaped_state = state.replace("'", "''")
        parts[f'{key}/{state}'] = dict(metadata, url=relative,
            where=f"session_key = '{escaped_key}' and state = '{escaped_state}'",
            electionIds=sorted({r['election_id'] for r in rows}), officeKeys=sorted({r['office_key'] for r in rows}),
            grains=sorted({r['grain'] for r in rows}), state=state)
    for session in sessions:
        for office in session['offices']:
            stats = office_stats[(session['key'], office['key'])]
            office['capabilities'].update(rows=stats['rows'], grains=sorted(stats['grains']), states=sorted(stats['states']),
                metrics={k: dict(knownRows=n, totalRows=stats['rows']) for k, n in sorted(stats['metrics'].items())})
            if session['legacyKey']:
                legacy = session['legacyKey']; code = int(office['id']) if office['id'].isdigit() else None
                available = []
                for name in ['res', 'tot', 'rdv', 'vt']:
                    if any(pid.startswith(legacy + '/') and (not p.get('offices') or code in p['offices'])
                           for pid, p in manifest['tables'].get(name, {}).get('parts', {}).items()):
                        available.append(name)
                office['capabilities']['tables'].extend(available)
                office['capabilities'].update(sectionResults='rdv' in available,
                    browserRdv='rdv' in available and legacy[:4] in ['2022', '2026'], times='vt' in available)
    sessions.sort(key=lambda s: (s['year'], s['date'] or '', s['turn'] or 0, s['key']))
    registry = dict(version=1, sessions=sessions, events=events_out, bindings=bindings,
                    historicalStates=HISTORICAL_STATES, tables={'units': 'election_units'},
                    counts=dict(sessions=len(sessions), events=len(events_out), units=sum(p['rows'] for p in parts.values())))
    write_json(data_dir / 'elections.json', registry)
    manifest['tables']['election_units'] = table_definition(parts)
    digest = hashlib.sha256(json.dumps(registry, sort_keys=True).encode()).hexdigest()[:16]
    manifest['version'] = manifest['version'].split('+elections-')[0] + '+elections-' + digest
    manifest['elections'] = dict(index='elections.json', **registry['counts'])
    write_json(manifest_path, manifest)
    for old in previous_paths - {p['url'] for p in parts.values()}:
        if not old.startswith('election-units/'):
            raise ValueError(f'unit generator does not own obsolete path: {old}')
        (data_dir / old).unlink(missing_ok=True)
    return registry


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--data-dir', type=Path, default=Path('data'))
    result = build(parser.parse_args().data_dir)
    print(json.dumps(result['counts']))
