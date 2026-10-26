"""Adapt verified official turnout JSONs to historical summary records."""
import concurrent.futures
import csv
import gzip
import hashlib
import json
import pathlib
import subprocess
import urllib.request


def election_configs():
    code = "import {ELECTION_LIST} from './src/elections.js'; console.log(JSON.stringify(ELECTION_LIST.filter(e=>e.hasTurnout).map(({key,year,turn,date,official})=>({key,year,turn,date,official}))))"
    return json.loads(subprocess.check_output(['node', '--input-type=module', '-e', code]))


def adapt(source, target, config, url, digest, normalize):
    expected_scope = {'br': 'br', 'uf': 'uf', 'city': 'mu', 'zone': 'zona'}.get(target.get('scope'))
    if expected_scope and source['tpabr'] != expected_scope:
        raise ValueError('Official JSON territorial grain does not match its verified target')
    event = int(source['ele'])
    office = source['carg']
    if len(office) != 1 or event not in config['official']['events'].values() or int(source['t']) != config['turn']:
        raise ValueError('Official JSON does not describe the configured single-office election')
    cargo = office[0]
    code = str(cargo['cd'])
    if event != int(config['official']['events'][code]):
        raise ValueError('Official election and office do not agree')
    e, v, s = source['e'], source['v'], source['s']
    for name in ['te', 'esi', 'esni', 'c', 'a']:
        if not str(e[name]).isdigit():
            raise ValueError('Missing official participation quantity')
    if int(e['c']) + int(e['a']) != int(e['esi']) or int(e['esi']) + int(e['esni']) != int(e['te']):
        raise ValueError('Official participation does not reconcile')
    raw = dict(ANO_ELEICAO=str(config['year']), NR_TURNO=str(config['turn']), CD_ELEICAO=str(event),
               DS_ELEICAO=f"Eleição Geral {config['year']} — {cargo['nmn']}", DT_ELEICAO='/'.join(reversed(config['date'].split('-'))),
               NM_TIPO_ELEICAO='Eleição Ordinária', SG_UF=target['state'], CD_MUNICIPIO=target.get('code', ''), NR_ZONA=target.get('zone', ''),
               CD_CARGO=code, DS_CARGO=cargo['nmn'], QT_APTOS=e['te'], QT_COMPARECIMENTO=e['c'], QT_ABSTENCOES=e['a'],
               QT_ELEITORES_SECOES_NAO_INSTALADAS=e['esni'], QT_VOTOS_BRANCOS=v.get('vb'), QT_VOTOS_NULOS=v.get('vn'),
               QT_TOTAL_VOTOS_NULOS=v.get('tvn'), QT_VOTOS_NULOS_TECNICOS=v.get('vnt'), QT_TOTAL_SECOES=s.get('ts'))
    resource = dict(id=f'official-{event}-{code}', url=url, sha256=digest)
    row = normalize(raw, resource)
    row['valid'] = int(v['vv']) if str(v.get('vv', '')).isdigit() else None
    row['transit'] = ''
    if row['installed'] != int(e['esi']):
        raise ValueError('Normalized official participation changed the source denominator')
    return row


def official_rows(root, normalize):
    manifest = json.loads(pathlib.Path('data/manifest.json').read_text())
    table = manifest['tables'].get('turnout')
    if not table:
        return
    columns = table['columns'].split(',')
    for config in election_configs():
        part = table['parts'][f'{config["key"]}/all']
        with gzip.open(pathlib.Path('data') / part['url'], 'rt') as text:
            rows = list(csv.DictReader(text, fieldnames=columns))
        if len(rows) != part['rows']:
            raise ValueError('Official turnout part row count mismatch')
        for target in rows:
            stem = target['state'] + target['code'] + (f'-z{target["zone"]}' if target['zone'] else '')
            data = pathlib.Path(f'.cache/turnout-{config["key"]}-{stem}.json').read_bytes()
            source = json.loads(data)
            if [int(source['e'][f]) for f in ['te', 'esi', 'esni', 'c', 'a']] != [int(target[f]) for f in ['electorate', 'installed', 'not_installed', 'present', 'absent']]:
                raise ValueError('Official JSON and verified turnout part differ')
            row = adapt(source, target, config, target['url'], hashlib.sha256(data).hexdigest(), normalize)
            yield row, config['year'], target['scope'] in ['br', 'uf']
        event = config['official']['events'].get('3')
        states = config['official'].get('governors', [])
        def governor(state):
            url = f'https://resultados.tse.jus.br/oficial/ele{config["year"]}/{event}/dados/{state}/{state}-c0003-e{event:06d}-u.json'
            path = root / 'official' / f'{config["key"]}-governor-{state}.json'
            if path.exists():
                data = path.read_bytes()
            else:
                with urllib.request.urlopen(url, timeout=40) as response:
                    data = response.read()
                path.parent.mkdir(parents=True, exist_ok=True)
                temporary = path.with_suffix('.json.part')
                temporary.write_bytes(data)
                temporary.replace(path)
            source = json.loads(data)
            if source['tpabr'] != 'uf' or source['cdabr'] != state:
                raise ValueError('Official governor territorial grain does not match')
            return adapt(source, dict(scope='uf', state=state), config, url, hashlib.sha256(data).hexdigest(), normalize)
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            for row in pool.map(governor, states):
                yield row, config['year'], True
