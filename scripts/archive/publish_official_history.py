#!/usr/bin/env python3
"""Preserve new official aggregate sources, referencing already released turnout originals."""
import argparse
import json
import pathlib
import subprocess
import hashlib
import zipfile
from official_history import election_configs
from tse_archive import read_json, write_json, sha256, publish_prepared


def publish(root):
    index = read_json(pathlib.Path('data/history/indicators.json'))
    for config in election_configs():
        identifier = f'official-history-{config["key"]}'
        tag = f'data-{identifier}'
        release_url = f'https://github.com/brauliobo/brazil-audit/releases/tag/{tag}'
        directory = root / 'releases' / identifier
        directory.mkdir(parents=True, exist_ok=True)
        dataset = dict(id=identifier, title=f'Fontes oficiais e fatos para comparação de turnos · {config["year"]}',
                       groups=['resultados'], family='resultados', sourceType='official-json', years=[config['year']],
                       license='', source=f'https://resultados.tse.jus.br/oficial/ele{config["year"]}/{config["official"]["events"]["1"]}/dados/br/br-c0001-e{config["official"]["events"]["1"]:06d}-u.json',
                       branch=f'archive/{identifier}', tag=tag, releaseUrl=release_url, normalized=False, inScope=True, status='prepared')
        old = json.loads(subprocess.check_output(['gh', 'api', f'repos/brauliobo/brazil-audit/releases/tags/data-{config["key"]}']))
        originals = [dict(name=a['name'], bytes=a['size'], sha256=a['digest'].removeprefix('sha256:'), url=a['browser_download_url']) for a in old['assets'] if a['name'].endswith('-official-turnout.zip')]
        if len(originals) != 1:
            raise ValueError('Expected one already verified official turnout archive')
        paths, entries = [], []
        entries.append(dict(id='official-presidential-turnout', name='Original presidential turnout JSONs', url=dataset['source'], status='prepared',
                            inScope=True, existingRelease=f'https://github.com/brauliobo/brazil-audit/releases/tag/data-{config["key"]}', existingAssets=originals, assets=[]))
        for state in config['official'].get('governors', []):
            event = config['official']['events']['3']
            path = root / 'official' / f'{config["key"]}-governor-{state}.json'
            source = read_json(path)
            if int(source['ele']) != event or int(source['t']) != config['turn'] or source['tpabr'] != 'uf' or source['cdabr'] != state:
                raise ValueError('Governor source identity mismatch')
            keys = set()
            def inspect(value):
                if isinstance(value, dict):
                    keys.update(value)
                    for child in value.values():
                        inspect(child)
                elif isinstance(value, list):
                    for child in value:
                        inspect(child)
            inspect(source)
            if any(any(token in key.lower() for token in ['cpf', 'email', 'telefone', 'bancaria']) for key in keys):
                raise ValueError('New direct personal identifier requires explicit public projection')
            url = f'https://resultados.tse.jus.br/oficial/ele{config["year"]}/{event}/dados/{state}/{state}-c0003-e{event:06d}-u.json'
            paths.append(path)
            entries.append(dict(id=f'governor-{state}-{event}', name=f'Governor · {state.upper()}', url=url, status='prepared', inScope=True,
                                sha256=sha256(path), bytes=path.stat().st_size, assets=[dict(name=path.name, bytes=path.stat().st_size, sha256=sha256(path))]))
        availability = pathlib.Path('.cache/transfers-governor-availability.json')
        comparisons = []
        if availability.exists():
            comparisons.extend({**r, 'input': pathlib.Path('.cache') / r['cache'], 'office': 'governor'} for r in read_json(availability) if r['status'] == 'available')
        first = next((e for e in election_configs(False) if e['turn'] == 1 and e['year'] == config['year']), None)
        if first:
            event = first['official']['events']['1']
            for path in sorted(pathlib.Path('.cache').glob(f'transfers-{first["year"]}-1-??.json')):
                state = path.stem.rsplit('-', 1)[-1]
                comparisons.append(dict(input=path, office='president', turn=1, event=event, state=state, code='', zone=None, scope='uf',
                    url=f'https://resultados.tse.jus.br/oficial/ele{first["year"]}/{event}/dados/{state}/{state}-c0001-e{event:06d}-u.json'))
        if comparisons:
            pack = directory / 'comparison-official-sources.zip'
            sources = []
            with zipfile.ZipFile(pack, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
                for source in comparisons:
                    data = source['input'].read_bytes()
                    raw = json.loads(data)
                    if int(raw['ele']) != source['event'] or int(raw['t']) != source['turn']:
                        raise ValueError('Comparison source identity mismatch')
                    name = f'{config["year"]}/t{source["turn"]}/{source["office"]}/{source["state"]}{source["code"] or ""}{"-z" + source["zone"] if source["zone"] else ""}.json'
                    archive.writestr(name, data)
                    sources.append({**{k: v for k, v in source.items() if k not in ['input', 'cache', 'status']}, 'path': name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
            with zipfile.ZipFile(pack) as archive:
                if archive.testzip():
                    raise ValueError('Comparison source pack CRC mismatch')
            metadata = directory / 'COMPARISON-SOURCES.json'
            write_json(metadata, dict(year=config['year'], rounds=[1, 2], sources=sources))
            paths.extend([pack, metadata])
            entries.append(dict(id='official-comparison-sources', name='Official comparison inputs, both rounds', url=comparisons[0]['url'],
                                status='prepared', inScope=True, sourceCount=len(sources), assets=[dict(name=p.name, bytes=p.stat().st_size, sha256=sha256(p)) for p in [pack, metadata]]))
        events = {str(v) for e in election_configs(False) if e['year'] == config['year'] for v in e['official']['events'].values()}
        for election in index['elections']:
            if election['year'] != config['year'] or election['turn'] not in [1, 2] or not events.intersection(election['sourceElectionIds']):
                continue
            for part in election['parts']:
                path = pathlib.Path('data') / part['url']
                paths.append(path)
                entries.append(dict(id=f'normalized-{election["id"]}', name=election['description'], url=election['sources'][0], status='prepared', inScope=True,
                                    normalizedSummary=True, rows=part['rows'], assets=[dict(name=path.name, bytes=path.stat().st_size, sha256=sha256(path))]))
        manifest = publish_prepared(root, dataset, entries, paths)
        write_json(root / 'official-published' / f'{identifier}.json', manifest)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=pathlib.Path, default=pathlib.Path('.cache/tse-archive'))
    publish(parser.parse_args().root)
