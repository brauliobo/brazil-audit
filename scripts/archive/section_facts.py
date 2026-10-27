#!/usr/bin/env python3
"""Normalize published section observations; keep them apart from official rollups."""
import argparse
import csv
import gzip
import hashlib
import io
import json
import pathlib
import re
import zipfile
import itertools
import concurrent.futures
from functools import lru_cache
from collections import Counter, OrderedDict, defaultdict

from candidate_facts import VOTE_FIELDS, VOTE_TYPES, first
from build_election_registry import UNIT_FIELDS, table_definition, unit_row
from normalize_history import normalize, number, office_key

NORMALIZATION_VERSION = 2
# Verified producer of this same data format; retain its original provenance hash.
CACHE_FORMATS = {'1196b63dd606696d3398f9d494519ba84a03ecde6250ea867c42c46341853cfd': 1, '71ce00b4d4c4709a9248d8cb7b5397c0e9e6ab01d8f6c11a048ca71fc3d6e11d': 1}
VOTE_TABLE = 'election_section_votes'
UNIT_TABLE = 'election_section_units'
SECTION_UNIT_FIELDS = [*UNIT_FIELDS, 'nominal_reported', 'legend_reported', 'source_member']
SECTION_VOTE_FIELDS = [*VOTE_FIELDS, 'reported_state', 'reported_constituency', 'identity_resolution', 'candidate_resolution', 'source_member', 'source_candidate_id']
LEGACY_VOTE_FIELDS = ['DATA_GERACAO', 'HORA_GERACAO', 'ANO_ELEICAO', 'NUM_TURNO', 'DESCRICAO_ELEICAO', 'SIGLA_UF', 'SIGLA_UE', 'CODIGO_MUNICIPIO', 'NOME_MUNICIPIO', 'NUM_ZONA', 'NUM_SECAO', 'CODIGO_CARGO', 'DESCRICAO_CARGO', 'NUM_VOTAVEL', 'QTDE_VOTOS']
MAX_RAW_BYTES = 16 * 1024 * 1024  # gzip's worst-case overhead remains below the 20 MB asset limit.
LOCAL_OFFICES = {'11', '12', '13', '25'}
LIST_OFFICES = {'6', '7', '8', '13'}
PARSER_SHA = hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest()


def source_resources(catalog):
    seen = set()
    for dataset in catalog['datasets']:
        for resource in dataset['resources']:
            url = resource['url']
            if resource.get('inScope') is False or url in seen:
                continue
            if '/votacao_secao/' in url or '/detalhe_votacao_secao/' in url:
                seen.add(url)
                yield resource


def source_path(root, url):
    return root / 'downloads' / hashlib.sha256(url.encode()).hexdigest() / url.rsplit('/', 1)[1]


def constituency(office, state, city):
    return 'br' if office == '1' else city if office in LOCAL_OFFICES else state


@lru_cache(maxsize=512)
def event_metadata(values):
    return normalize(dict(values), {'url': '', 'id': ''})


def section_identity(raw, metrics=False):
    keys = ['ANO_ELEICAO', 'NR_TURNO', 'CD_ELEICAO', 'DS_ELEICAO', 'DT_ELEICAO', 'NM_TIPO_ELEICAO', 'CD_CARGO', 'DS_CARGO']
    row = normalize(raw, {'url': '', 'id': ''}) if metrics else event_metadata(tuple((k,raw.get(k)) for k in keys)).copy()
    row.update(state=(raw.get('SG_UF') or '').lower() or None,
               city_code=str(int(raw['CD_MUNICIPIO'])).zfill(5) if number(raw.get('CD_MUNICIPIO')) is not None else '',
               zone=str(int(raw['NR_ZONA'])).zfill(4) if number(raw.get('NR_ZONA')) is not None else '',
               transit=raw.get('ST_VOTO_EM_TRANSITO') or None)
    section = number(raw.get('NR_SECAO'))
    if not row['city_code'] or not row['zone'] or section is None:
        raise ValueError('Section source is missing its municipality, zone or section identity')
    return row, str(section).zfill(4)


class LegacyContext:
    """The official ZIP's LEIAME.pdf defines its 15-column headerless layout."""
    def __init__(self, data, source_year):
        index = json.loads((data/'history/indicators.json').read_text())
        self.events = defaultdict(list)
        self.event_by_id = {}
        self.geography = defaultdict(set)
        self.data = data
        self.loaded = set()
        for event in index['elections']:
            if source_year not in event['sourceDatasetYears']:
                continue
            self.event_by_id[event['id']] = event
            for office in event['offices']:
                self.events[(str(event['year']),str(event['turn']),str(office['id']))].append(event)

    def resolve(self, values):
        original = dict(zip(LEGACY_VOTE_FIELDS,values))
        matches = self.events[(original['ANO_ELEICAO'],original['NUM_TURNO'],original['CODIGO_CARGO'])]
        if len(matches) != 1:
            raise ValueError('Headerless section source has ambiguous election identity')
        event = matches[0]
        if event['id'] not in self.loaded:
            for part in event['parts']:
                with gzip.open(self.data/part['url'],'rt',encoding='utf8',newline='') as stream:
                    for row in csv.DictReader(stream):
                        if row['city_code']:
                            self.geography[(event['id'],row['city_code'])].add(row['state'])
            self.loaded.add(event['id'])
        aliases = dict(DT_GERACAO='DATA_GERACAO',HH_GERACAO='HORA_GERACAO',NR_TURNO='NUM_TURNO',DS_ELEICAO='DESCRICAO_ELEICAO',
                       SG_UF='SIGLA_UF',SG_UE='SIGLA_UE',CD_MUNICIPIO='CODIGO_MUNICIPIO',NM_MUNICIPIO='NOME_MUNICIPIO',
                       NR_ZONA='NUM_ZONA',NR_SECAO='NUM_SECAO',CD_CARGO='CODIGO_CARGO',DS_CARGO='DESCRICAO_CARGO',
                       NR_VOTAVEL='NUM_VOTAVEL',QT_VOTOS='QTDE_VOTOS')
        result = {k:original[v] for k,v in aliases.items()}
        result.update(ANO_ELEICAO=original['ANO_ELEICAO'],CD_ELEICAO=event['sourceElectionIds'][0],DT_ELEICAO=event['dates'][0],
                      _reported_state=original['SIGLA_UF'],_identity_resolution='unique-election-source-bridge')
        if result['SG_UF'].lower() == 'br':
            code = str(int(result['CD_MUNICIPIO'])).zfill(5)
            states = self.geography.get((event['id'],code),set())
            if len(states)>1:
                raise ValueError('Headerless section municipality has ambiguous same-election state identity')
            result['SG_UF'] = next(iter(states)) if states else ''
            result['_identity_resolution'] += '+same-election-municipality' if states else '+unresolved-municipality'
        return result


class CandidateLookup:
    """Only exact source identities and unambiguous ballot-number joins are accepted."""
    def __init__(self, records):
        self.numbers = defaultdict(dict)
        self.sequences = defaultdict(dict)
        for candidate in records:
            candidate = {k:candidate.get(k) for k in ['election_id','office','constituency','number','candidate_id','source_candidate_id']}
            key = (candidate['election_id'], candidate['office'], candidate['constituency'], candidate['number'])
            self.numbers[key][candidate['candidate_id']] = candidate
            if candidate.get('source_candidate_id'):
                sequence = (candidate['election_id'],candidate['office'],candidate['constituency'],candidate['source_candidate_id'])
                self.sequences[sequence][candidate['candidate_id']] = candidate

    def resolve(self, raw, row, kind):
        office, state, city = row['office'], row['state'], row['city_code']
        ue = constituency(office, state, city)
        sequence = first(raw,'SQ_CANDIDATO')
        if sequence:
            matches = list(self.sequences.get((row['election_id'],office,ue,sequence),{}).values())
            if len(matches)==1:
                return matches[0], 'official-sequence'
            if len(matches)>1:
                return None, 'ambiguous-official-sequence'
        key = (row['election_id'], office, ue, raw['NR_VOTAVEL'])
        candidates = [c for c in self.numbers.get(key, {}).values() if c['candidate_id'].startswith(kind + ':')]
        if len(candidates) == 1:
            if sequence and candidates[0].get('source_candidate_id'):
                return None, 'unmatched-official-sequence'
            return candidates[0], 'unambiguous-ballot-number'
        return None, 'ambiguous-ballot-number' if candidates else 'unmatched-ballot-number'


def vote_record(raw, lookup, source):
    unit, section = section_identity(raw)
    ballot = first(raw, 'NR_VOTAVEL')
    if ballot is None:
        raise ValueError('Missing source ballot number')
    special = {'95':'blank','96':'null_native','97':'annulled_separate'}
    kind = special.get(ballot) or ('party_list' if unit['office'] in LIST_OFFICES and len(ballot) == 2 else 'candidate')
    match, method = (None, 'source-category') if ballot in special else lookup.resolve(raw, unit, kind)
    count = number(raw.get('QT_VOTOS'))
    if count is None:
        raise ValueError('Missing or negative published section vote count')
    if match:
        candidate = match['candidate_id']
    elif ballot in special:
        candidate = kind
    else:
        # An unresolved ballot keeps a source identity; it is never silently joined by a similar name.
        key = [unit['election_id'], unit['office_key'], constituency(unit['office'], unit['state'], unit['city_code']), kind, ballot]
        candidate = 'unresolved:' + hashlib.sha256(json.dumps(key, separators=(',', ':')).encode()).hexdigest()[:24]
    result = dict(election_id=unit['election_id'], grain='section', state=unit['state'], city_code=unit['city_code'],
                  zone=unit['zone'], section=section, office=unit['office'], office_key=unit['office_key'],
                  constituency=constituency(unit['office'], unit['state'], unit['city_code']), candidate_id=candidate,
                  kind=kind, number=ballot, votes=count, destination='reported', transit=unit['transit'] or None, **source)
    result.update(reported_state=raw.get('_reported_state',raw.get('SG_UF')),reported_constituency=raw.get('SG_UE'),
                  identity_resolution=raw.get('_identity_resolution','source-election-and-state'),candidate_resolution=method,
                  source_member=raw.get('_source_member'),source_candidate_id=first(raw,'SQ_CANDIDATO'))
    return result, method


def section_unit(raw, session, source):
    normalized, section = section_identity(raw,metrics=True)
    normalized.update(scope='section', source_url=source['source_url'], source_sha256=source['source_sha256'], source_id=source['source_id'])
    result = unit_row(normalized, session)
    result.update(section=section, sections=1, source_year=source['source_year'],
                  nominal_reported=number(raw.get('QT_VOTOS_NOMINAIS')), legend_reported=number(raw.get('QT_VOTOS_LEGENDA')),
                  source_member=raw.get('_source_member'))
    return result


class PartitionWriter:
    """Bounded open files and bytes; partitions are lazy by event, UF, city and office."""
    def __init__(self, output, fields, table, source, max_raw=MAX_RAW_BYTES, open_limit=48):
        self.output, self.fields, self.table, self.source = output, fields, table, source
        self.max_raw, self.open_limit = max_raw, open_limit
        self.open = OrderedDict()
        self.sequence = Counter()
        self.parts = {}
        self.counts = Counter()

    def _close(self, key):
        item = self.open.pop(key)
        item['text'].close()
        item['file'].close()
        path = item['path']
        data = path.read_bytes()
        if len(data) >= 20 * 1024 * 1024:
            raise ValueError('Section asset exceeds the browser part limit')
        row = item['sample']
        where = ' and '.join(f"{k} is null" if row[k] is None else f"{k} = '{str(row[k]).replace(chr(39), chr(39)*2)}'" for k in ['election_id', 'state', 'city_code', 'office'])
        self.parts[item['id']] = dict(url=str(path.relative_to(self.output)), rows=item['rows'], bytes=len(data), rawBytes=item['raw'],
                                     sha256=hashlib.sha256(data).hexdigest(), where=where,
                                     electionIds=[row['election_id']], officeKeys=[row['office_key']], offices=[int(row['office'])],
                                     states=[row['state']], cities=[row['city_code']], grains=['section'], role='section-observation',
                                     source_url=self.source['source_url'], source_sha256=self.source['source_sha256'])

    def write(self, row):
        key = (row['election_id'], row['state'], row['city_code'], row['office'])
        buffer = io.StringIO(newline='')
        csv.writer(buffer, lineterminator='\n').writerow([row.get(k) for k in self.fields])
        line = buffer.getvalue()
        size = len(line.encode())
        if key in self.open and self.open[key]['raw'] + size > self.max_raw:
            self._close(key)
        if key not in self.open:
            if len(self.open) >= self.open_limit:
                self._close(next(iter(self.open)))
            n = self.sequence[key]; self.sequence[key] += 1
            event = row['election_id'].replace(':', '-')
            part_id = f'{self.source["source_year"]}/{event}/{row["state"]}/{row["city_code"]}/{row["office"]}/{n}'
            path = self.output / f'{self.table}/{part_id}.csv.gz'
            path.parent.mkdir(parents=True, exist_ok=True)
            file = path.open('wb')
            binary = gzip.GzipFile(filename='', mode='wb', fileobj=file, mtime=0, compresslevel=6)
            text = io.TextIOWrapper(binary, encoding='utf8', newline='')
            self.open[key] = dict(text=text, file=file, path=path, rows=0, raw=0, id=part_id, sample=row)
        item = self.open[key]
        item['text'].write(line); item['rows'] += 1; item['raw'] += size
        self.open.move_to_end(key)
        self.counts[(row['election_id'], row['state'], row['office'], row.get('kind'))] += row.get('votes', 1)

    def finish(self):
        for key in list(self.open):
            self._close(key)
        return self.parts


def source_rows(path, state=None, legacy=None):
    with zipfile.ZipFile(path) as archive:
        members = [m for m in archive.namelist() if m.lower().endswith(('.txt','.csv'))]
        national = next((m for m in members if re.search(r'_BR\.(?:txt|csv)$',m,re.I)),None)
        national = national or next((m for m in members if re.search(r'_BRASIL\.(?:txt|csv)$',m,re.I)),None)
        state_members = {match[1].lower() for m in members if (match:=re.search(r'_([A-Za-z]{2})\.(?:txt|csv)$',m)) and match[1].lower()!='br'}
        for member in members:
            member_state = re.search(r'_([A-Za-z]{2})\.(?:txt|csv)$', member)
            if state and member_state and member_state[1].lower() not in [state, 'br']:
                continue
            with archive.open(member) as stream:
                reader = csv.reader(io.TextIOWrapper(stream, encoding='latin1', newline=''), delimiter=';')
                first_row = next(reader,None)
                if first_row is None:
                    continue
                header = 'NR_SECAO' in first_row and 'CD_ELEICAO' in first_row
                if not header and (legacy is None or len(first_row)!=len(LEGACY_VOTE_FIELDS)):
                    raise ValueError(f'Unsupported section source schema: {member}')
                for values in reader if header else itertools.chain([first_row],reader):
                    if len(values)!=(len(first_row) if header else len(LEGACY_VOTE_FIELDS)):
                        raise ValueError(f'Section source column count mismatch: {member}')
                    row = dict(zip(first_row,values)) if header else legacy.resolve(values)
                    office = row['CD_CARGO']
                    # BR/BRASIL and UF members overlap in official ZIPs. Presidential
                    # observations use their national member; other offices use UF
                    # members when present, retaining additional unrepresented UFs.
                    if national and len(members)>1:
                        if office=='1' and member!=national:
                            continue
                        if office!='1' and member==national and row['SG_UF'].lower() in state_members:
                            continue
                    row['_source_member'] = member
                    if not state or row['SG_UF'].lower() == state:
                        yield row


def load_candidates(data, source_year, state=None, president_only=False):
    index_path = data / 'history/facts' / str(source_year) / 'index.json'
    index = json.loads(index_path.read_text())
    definition = index['tables']['election_candidates']
    fields = definition['columns'].split(',')
    for key, part in definition['parts'].items():
        if state and key.split('/')[1] != state:
            continue
        path = data / part['url']
        with gzip.open(path, 'rt', encoding='utf8', newline='') as stream:
            for values in csv.reader(stream):
                candidate = dict(zip(fields, values))
                if not president_only or candidate['office'] == '1':
                    yield candidate


def process_resource(resource, root, data, output, state=None, candidate_data=None, lookup=None, source_digest=None):
    url = resource['url']
    source_year = int(re.search(r'_(\d{4})(?:_[A-Za-z]{2})?\.zip$', url)[1])
    path = source_path(root, url)
    digest = source_digest or hashlib.file_digest(path.open('rb'), 'sha256').hexdigest()
    source = dict(source_url=url, source_sha256=digest, source_year=source_year)
    is_votes = '/votacao_secao/' in url
    source_state = re.search(r'_([A-Za-z]{2})\.zip$', url)
    selected_state = state or (source_state[1].lower() if source_state and source_state[1].lower() != 'br' else None)
    registry = json.loads((data / 'elections.json').read_text())
    sessions = {event: session for session in registry['sessions'] for event in session['eventIds']}
    president_only = bool(source_state and source_state[1].lower() == 'br')
    lookup = lookup or (CandidateLookup(load_candidates(candidate_data or data, source_year, None if president_only else selected_state, president_only=president_only)) if is_votes else None)
    writer = PartitionWriter(output, SECTION_VOTE_FIELDS if is_votes else SECTION_UNIT_FIELDS, VOTE_TABLE if is_votes else UNIT_TABLE, source)
    methods = Counter(); rows = 0
    for raw in source_rows(path, state,LegacyContext(data,source_year) if is_votes else None):
        if is_votes:
            row, method = vote_record(raw, lookup, source)
            methods[method] += 1
        else:
            event, _ = section_identity(raw)
            if event['election_id'] not in sessions:
                raise ValueError(f'Unregistered section election: {event["election_id"]}')
            row = section_unit(raw, sessions[event['election_id']], {**source, 'source_id': resource['id']})
        writer.write(row); rows += 1
    parts = writer.finish()
    fields = SECTION_VOTE_FIELDS if is_votes else SECTION_UNIT_FIELDS
    if is_votes:
        types = [*VOTE_TYPES,*['text']*6]
    else:
        ddl = table_definition({})['ddl']
        types = [piece.rsplit(' ', 1)[1] for piece in ddl[ddl.index('(')+1:-1].split(', ')] + ['bigint', 'bigint', 'text']
    table = VOTE_TABLE if is_votes else UNIT_TABLE
    result = dict(source=source, rows=rows, identityMethods=dict(methods), counts=[dict(election_id=k[0],state=k[1],office=k[2],kind=k[3],count=v) for k,v in writer.counts.items()],
                  table=dict(name=table, columns=','.join(fields), ddl=f'create table {table} ('+', '.join(f'{k} {t}' for k,t in zip(fields,types))+')', parts=parts))
    target = output / 'sources' / f'{hashlib.sha256(url.encode()).hexdigest()}.json'
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(result, ensure_ascii=False, indent=1)+'\n')
    return result


def cached_identities_match(record, output, lookup, data):
    if record['table']['name']!=VOTE_TABLE:
        return True
    fields=record['table']['columns'].split(',')
    legacy=None
    for part in record['table']['parts'].values():
        with gzip.open(output/part['url'],'rt',encoding='utf8',newline='') as stream:
            for values in csv.reader(stream):
                row=dict(zip(fields,values));row['state']=row['state'] or None
                ue=constituency(row['office'],row['state'],row['city_code'])
                if ue!=row['constituency']:
                    return False
                if row['kind'] in ['candidate','party_list']:
                    match,_=lookup.resolve({'NR_VOTAVEL':row['number'],'SQ_CANDIDATO':row.get('source_candidate_id')},row,row['kind'])
                    identity_value=match['candidate_id'] if match else 'unresolved:'+hashlib.sha256(json.dumps([row['election_id'],row['office_key'],ue,row['kind'],row['number']],separators=(',',':')).encode()).hexdigest()[:24]
                    if identity_value!=row['candidate_id']:
                        return False
                if (row.get('reported_state') or '').lower()=='br' and row.get('identity_resolution','').startswith('unique-election-source-bridge'):
                    legacy=legacy or LegacyContext(data,record['source']['source_year'])
                    event=legacy.event_by_id.get(row['election_id'])
                    if event is None:
                        return False
                    values=['','',str(event['year']),str(event['turn']),'','BR',row.get('reported_constituency') or '',row['city_code'],'',row['zone'],row['section'],row['office'],'',row['number'],row['votes']]
                    resolved=legacy.resolve(values)
                    if (resolved['SG_UF'].lower() or None)!=row['state']:
                        return False
    return True


def process_job(resource, root, data, output, state, resume, candidate_data):
    key = hashlib.sha256(resource['url'].encode()).hexdigest()
    previous = output/'sources'/f'{key}.json'
    year = int(re.search(r'_(\d{4})(?:_[A-Za-z]{2})?\.zip$',resource['url'])[1])
    code_hash = PARSER_SHA
    candidate_index = candidate_data/'history/facts'/str(year)/'index.json'
    candidate_hash = hashlib.sha256(candidate_index.read_bytes()).hexdigest() if '/votacao_secao/' in resource['url'] else None
    try:
        source_digest=hashlib.file_digest(source_path(root,resource['url']).open('rb'),'sha256').hexdigest()
        lookup=None
        geography_hash=hashlib.sha256((data/'history/indicators.json').read_bytes()).hexdigest() if re.search(r'_BR\.zip$',resource['url'],re.I) else None
        if resume and previous.exists():
            record = json.loads(previous.read_text())
            format_version = record.get('normalizationVersion',CACHE_FORMATS.get(record.get('parserSha256')))
            if format_version in [1,NORMALIZATION_VERSION] and record['source']['source_sha256']==source_digest and record.get('scopeState')==state:
                for part in record['table']['parts'].values():
                    if hashlib.file_digest((output/part['url']).open('rb'),'sha256').hexdigest()!=part['sha256']:
                        raise ValueError('Cached section part hash mismatch')
                affected_local=record['table']['name']==VOTE_TABLE and any(c['office']=='25' for c in record['counts'])
                if record.get('candidateIndexSha256')==candidate_hash and record.get('geographyIndexSha256')==geography_hash and not affected_local:
                    return {'url':resource['url'],'status':'ready','rows':record['rows'],'cached':True}
                if '/votacao_secao/' in resource['url']:
                    country=bool(re.search(r'_BR\.zip$',resource['url'],re.I));match=re.search(r'_([A-Za-z]{2})\.zip$',resource['url'])
                    selected=state or (match[1].lower() if match and not country else None)
                    lookup=CandidateLookup(load_candidates(candidate_data,year,None if country else selected,president_only=country))
                if cached_identities_match(record,output,lookup,data):
                    return {'url':resource['url'],'status':'ready','rows':record['rows'],'cached':True,'identitiesRevalidated':True}
        if previous.exists():
            audit=output/'previous'/previous.name;audit.parent.mkdir(parents=True,exist_ok=True);previous.replace(audit)
        record = process_resource(resource,root,data,output,state,candidate_data,lookup,source_digest)
        record.update(normalizationVersion=NORMALIZATION_VERSION,parserSha256=code_hash,candidateIndexSha256=candidate_hash,geographyIndexSha256=geography_hash,scopeState=state,status='ready')
        previous.write_text(json.dumps(record,ensure_ascii=False,indent=1)+'\n')
        return {'url':resource['url'],'status':'ready','rows':record['rows'],'identityMethods':record['identityMethods'],'parts':len(record['table']['parts'])}
    except Exception as error:
        failure = {'url':resource['url'],'status':'error','errorType':type(error).__name__,
                   'reason':str(error) if isinstance(error,ValueError) else 'Required source input or output operation failed.'}
        target=output/'errors'/f'{key}.json';target.parent.mkdir(parents=True,exist_ok=True)
        target.write_text(json.dumps(failure,ensure_ascii=False,indent=1)+'\n')
        return failure


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=pathlib.Path, required=True)
    parser.add_argument('--data', type=pathlib.Path, default=pathlib.Path('data'))
    parser.add_argument('--candidate-data', type=pathlib.Path)
    parser.add_argument('--output', type=pathlib.Path, required=True)
    parser.add_argument('--year', type=int)
    parser.add_argument('--state')
    parser.add_argument('--workers', type=int, choices=range(1,5), default=2)
    parser.add_argument('--resume', action='store_true')
    args = parser.parse_args()
    catalog = json.loads((args.root/'catalog/catalog.json').read_text())
    resources = [r for r in source_resources(catalog) if args.year is None or re.search(fr'_{args.year}(?:_[A-Za-z]{{2}})?\.zip$',r['url'])]
    if args.state:
        resources = [r for r in resources if re.search(r'_(?:'+args.state+r'|BR)\.zip$',r['url'],re.I) or '/detalhe_votacao_secao/' in r['url']]
    with concurrent.futures.ProcessPoolExecutor(max_workers=args.workers) as pool:
        futures = [pool.submit(process_job,resource,args.root,args.data,args.output,args.state,args.resume,args.candidate_data or args.data) for resource in resources]
        for future in concurrent.futures.as_completed(futures):
            print(json.dumps(future.result()),flush=True)


if __name__ == '__main__':
    main()
