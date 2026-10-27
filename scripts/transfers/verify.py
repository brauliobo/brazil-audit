"""Verify factual browser tables and the explicitly optional model diagnostics."""
import csv,gzip,hashlib,json
from pathlib import Path
from state_facts import ROUND_FIELDS,ROUND_TYPES,COUNT_FIELDS,COUNT_TYPES,validate
from status import assess,GATES


def rows(name,fields,types,manifest):
    result=[]
    table=manifest['tables'][name]
    assert table['columns'].split(',')==fields
    for part in table['parts'].values():
        path=Path('data')/part['url'];body=path.read_bytes()
        assert len(body)==part['bytes'] and hashlib.sha256(body).hexdigest()==part['sha256']
        raw=gzip.decompress(body);assert b'\r' not in raw
        with gzip.open(path,'rt',newline='') as stream:
            data=list(csv.reader(stream,quoting=csv.QUOTE_NOTNULL))
        assert len(data)==part['rows']
        for row in data:
            assert len(row)==len(fields)
            converted=[]
            for value,type_ in zip(row,types):
                converted.append(None if value is None else int(value) if type_ in ['int','bigint'] else value.lower()=='true' if type_=='boolean' else value)
            result.append(converted)
    return result


def verify():
    manifest=json.loads(Path('data/manifest.json').read_text())
    rounds=rows('state_rounds',ROUND_FIELDS,ROUND_TYPES,manifest);counts=rows('state_round_counts',COUNT_FIELDS,COUNT_TYPES,manifest)
    validate(rounds,counts)
    assert manifest['stateFacts']['status']=='ready'
    assert sorted(set(r[2] for r in rounds))==manifest['stateFacts']['availableYears']
    for fields,data in [(ROUND_FIELDS,rounds),(COUNT_FIELDS,counts)]:
        for row in data:assert len(row[fields.index('source_sha256')])==64
    optional=json.loads(Path('data/transfers/index.json').read_text())
    assert optional['defaultAnalysis']=='browser-sql'
    for entry in optional['models']:
        body=(Path('data')/entry['url']).read_bytes()
        assert hashlib.sha256(body).hexdigest()==entry['sha256'] and len(body)==entry['bytes']
        model=json.loads(body);assert model['contest_id']==entry['contest_id']
        assert model['status']==entry['status'] and model['reason']==entry['reason']
        cells=model['cells'];assert len(cells)==len(model['from'])*len(model['to'])
        if model['status']=='estimated':
            assert not assess(model['diagnostics'])
            sensitivity=model['diagnostics']['priorSensitivity']
            assert sensitivity['status']=='evaluated' and not assess(sensitivity['alternativeDiagnostics'])
            assert sensitivity['maxRowShareChange']<=GATES['priorSensitivityPP']/100
            for i,row in enumerate(model['from']):
                selected=cells[i*len(model['to']):(i+1)*len(model['to'])]
                assert abs(sum(c['rowShare'] for c in selected)-1)<1e-10
                for cell in selected:assert abs(cell['rowShare']-cell['estimate']/row['total'])<1e-10
        else:assert all(c['estimate'] is None and c['rowShare'] is None for c in cells)
    print(json.dumps({'verifiedRounds':len(rounds),'verifiedCategories':len(counts),'optionalModels':len(optional['models'])}))

if __name__=='__main__':verify()
