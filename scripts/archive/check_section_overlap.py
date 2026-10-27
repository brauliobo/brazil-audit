#!/usr/bin/env python3
"""Prove a source domain is reproduced exactly in another published section source."""
import argparse
import hashlib
import json
import pathlib
from collections import Counter
from section_facts import source_path, source_rows, LegacyContext

KEY_FIELDS = ['ANO_ELEICAO','NR_TURNO','CD_ELEICAO','DT_ELEICAO','SG_UF','CD_MUNICIPIO','NR_ZONA','NR_SECAO','CD_CARGO','NR_VOTAVEL']

def compare(primary, duplicate):
    if dict(primary) != dict(duplicate):
        raise ValueError('The candidate duplicate has different observations or counts')
    encoded=json.dumps(sorted((list(k),v) for k,v in duplicate.items()),separators=(',',':')).encode()
    return dict(keys=len(duplicate),votes=sum(duplicate.values()),observationSha256=hashlib.sha256(encoded).hexdigest())

def prove(root, data, primary_url, duplicates, year):
    domains={url:Counter() for url in duplicates}
    primary={url:Counter() for url in duplicates}
    filters={}
    hashes={}
    for url in [*duplicates,primary_url]:
        path=source_path(root,url);hashes[url]=hashlib.file_digest(path.open('rb'),'sha256').hexdigest()
        for row in source_rows(path,legacy=LegacyContext(data,year)):
            key=tuple(row.get(f,'') for f in KEY_FIELDS)
            if url==primary_url:
                for other,domain in filters.items():
                    if (row['SG_UF'],row['CD_CARGO']) in domain:primary[other][key]+=int(row['QT_VOTOS'])
            else:domains[url][key]+=int(row['QT_VOTOS'])
        if url!=primary_url:filters[url]={(key[4],key[8]) for key in domains[url]}
    return dict(version=1,keyFields=KEY_FIELDS,primary=dict(source_url=primary_url,source_sha256=hashes[primary_url]),duplicates=[
        dict(source_url=url,source_sha256=hashes[url],domains=[dict(state=s.lower(),office=o) for s,o in sorted(filters[url])],**compare(primary[url],domains[url])) for url in duplicates])

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--root',type=pathlib.Path,required=True);p.add_argument('--data',type=pathlib.Path,default=pathlib.Path('data'));p.add_argument('--primary',required=True);p.add_argument('--duplicate',action='append',required=True);p.add_argument('--year',type=int,required=True);p.add_argument('--output',type=pathlib.Path,required=True);a=p.parse_args()
    result=prove(a.root,a.data,a.primary,a.duplicate,a.year);a.output.write_text(json.dumps(result,indent=1)+'\n');print(json.dumps(result),flush=True)
