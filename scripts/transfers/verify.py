"""Verify published model artifacts against their exact aggregate inputs."""
import hashlib,json
from pathlib import Path
import numpy as np
from engine import feasible_bounds


def verify():
    index=json.loads(Path('data/transfers/index.json').read_text())
    checked=0;estimated=0
    for entry in index['contests']:
        path=Path('data')/entry['url'];body=path.read_bytes()
        assert hashlib.sha256(body).hexdigest()==entry['sha256'],entry['id']
        assert len(body)==entry['bytes'],entry['id']
        model=json.loads(body)
        assert model['status']==entry['status'] and model['reason']==entry['reason']
        rows,cols=model['from'],model['to'];cells=model['cells']
        assert len(cells)==len(rows)*len(cols),entry['id']
        if 'inputs' in entry:
            p=Path('data')/entry['inputs']['url'];source=p.read_bytes()
            assert hashlib.sha256(source).hexdigest()==entry['inputs']['sha256']
            assert len(source)==entry['inputs']['bytes']
            matrices=np.load(p);x,y=matrices['x'],matrices['y']
            assert len(x)==entry['coverage']['units']
            if len(x):
                lo,hi=feasible_bounds(x,y)
                np.testing.assert_array_equal([r['total'] for r in rows],x.sum(axis=0))
                np.testing.assert_array_equal([r['total'] for r in cols],y.sum(axis=0))
                for i in range(len(rows)):
                    for j in range(len(cols)):
                        c=cells[i*len(cols)+j]
                        assert c['from']==rows[i]['id'] and c['to']==cols[j]['id']
                        assert c['boundLow']==lo[i,j] and c['boundHigh']==hi[i,j]
        if model['status']=='estimated':
            estimated+=1
            counts=np.array([c['estimate'] for c in cells]).reshape(len(rows),len(cols))
            np.testing.assert_allclose(counts.sum(axis=1),[r['total'] for r in rows],atol=1e-6)
            np.testing.assert_allclose(counts.sum(axis=0),[r['total'] for r in cols],atol=1e-6)
            for c in cells:
                assert c['boundLow']<=c['low']<=c['high']<=c['boundHigh']
                assert c['boundLow']<=c['estimate']<=c['boundHigh']
        else:
            assert all(c['estimate'] is None and c['rowShare'] is None for c in cells)
        checked+=1
    print(json.dumps({'verifiedArtifacts':checked,'estimated':estimated,'pending':sum(c['reason']=='model_pending' for c in index['contests'])}))

if __name__=='__main__':verify()
