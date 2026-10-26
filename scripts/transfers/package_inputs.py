"""Publish the exact aggregated input matrices used by each ecological fit."""
import fcntl,hashlib,json,shutil
from pathlib import Path
import numpy as np


def main():
    root=Path('data/transfers');destination=root/'inputs';destination.mkdir(exist_ok=True)
    indexpath=root/'index.json'
    with Path('.cache/transfers-index.lock').open('w') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        index=json.loads(indexpath.read_text())
        for contest in index['contests']:
            source=Path('.cache/transfers-inputs')/f"{contest['id']}.npz"
            if not source.exists():continue
            target=destination/source.name;shutil.copyfile(source,target)
            arrays=np.load(target)
            if len(arrays['x'])!=contest['coverage']['units']:raise ValueError('input coverage mismatch')
            contest['inputs']={'url':f'transfers/inputs/{target.name}','sha256':hashlib.sha256(target.read_bytes()).hexdigest(),
                               'bytes':target.stat().st_size,'encoding':'numpy-npz','units':len(arrays['x'])}
        indexpath.write_text(json.dumps(index,ensure_ascii=False,indent=2)+'\n')

if __name__=='__main__':main()
