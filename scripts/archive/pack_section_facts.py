#!/usr/bin/env python3
"""Pack section facts for browser transport without changing their observational grain."""
import argparse
import csv
import gzip
import hashlib
import io
import json
import pathlib
import concurrent.futures
from collections import Counter

MAX_ROWS = 50000
MAX_RAW = 32 * 1024 * 1024


class Packs:
    def __init__(self, output, table, fields, source_key):
        self.output, self.table, self.fields, self.source_key = output, table, fields, source_key
        self.handles = {}
        self.sequence = Counter()
        self.parts = {}
        self.rows = 0

    def close(self, key):
        item = self.handles.pop(key)
        item['stream'].close();item['file'].close()
        path = item['path'];packed = path.read_bytes()
        if len(packed)>=20*1024*1024:
            raise ValueError('A section transport pack exceeds 20 MiB')
        cities = sorted(item['cities'])
        self.parts[item['id']] = dict(url=str(path.relative_to(self.output)),rows=item['rows'],bytes=len(packed),rawBytes=item['raw'],
            sha256=hashlib.sha256(packed).hexdigest(),where="source_part = '"+item['id']+"'",sourcePart=item['id'],
            states=[key[0]],offices=[int(key[1])],officeKeys=sorted(item['offices']),electionIds=sorted(item['events']),
            cities=cities,cityMin=cities[0] if cities else None,cityMax=cities[-1] if cities else None,
            grains=['section'],role='section-observation')

    def write(self, row):
        key = (row['state'],row['office'])
        if key in self.handles and (self.handles[key]['rows']>=MAX_ROWS or self.handles[key]['raw']>=MAX_RAW):
            self.close(key)
        if key not in self.handles:
            n=self.sequence[key];self.sequence[key]+=1
            state=key[0] or 'unresolved'
            part_id=f'{self.source_key}/{state}/{key[1]}/{n:05}'
            path=self.output/self.table/(part_id+'.csv.gz');path.parent.mkdir(parents=True,exist_ok=True)
            file=path.open('wb');compressed=gzip.GzipFile(filename='',mode='wb',fileobj=file,mtime=0,compresslevel=6)
            stream=io.TextIOWrapper(compressed,encoding='utf8',newline='')
            self.handles[key]=dict(file=file,stream=stream,path=path,id=part_id,rows=0,raw=0,cities=set(),events=set(),offices=set())
        item=self.handles[key];row={**row,'source_part':item['id']}
        buffer=io.StringIO(newline='');csv.writer(buffer,lineterminator='\n').writerow([row.get(k) for k in self.fields])
        text=buffer.getvalue();item['stream'].write(text);item['rows']+=1;item['raw']+=len(text.encode())
        if row['city_code']:item['cities'].add(row['city_code'])
        item['events'].add(row['election_id']);item['offices'].add(row['office_key']);self.rows+=1

    def finish(self):
        for key in list(self.handles):self.close(key)
        return self.parts


UNIT_METRICS = ['eligible','installed','present','absent','blank','null_votes','null_total','null_technical','annulled','annulled_subjudice','annulled_separate','ballots','ballots_reported','valid','nominal','legend','sections','not_installed','nominal_reported','legend_reported']


def attach_metric_coverage(record, output):
    if record['table']['name']!='election_section_units' or record.get('metricCoverageVersion')==1:
        return record
    table=record['table'];fields=table['columns'].split(',');metrics=[field for field in UNIT_METRICS if field in fields]
    coverage={}
    for part in table['parts'].values():
        with gzip.open(output/part['url'],'rt',encoding='utf8',newline='') as stream:
            for values in csv.reader(stream):
                row=dict(zip(fields,values));key=(row['election_id'],row['office_key'],row['state'])
                item=coverage.setdefault(key,dict(election_id=key[0],office_key=key[1],state=key[2] or None,rows=0,metrics={field:{'knownRows':0,'totalRows':0} for field in metrics}))
                item['rows']+=1
                for field in metrics:
                    item['metrics'][field]['totalRows']+=1
                    item['metrics'][field]['knownRows']+=row[field]!=''
    return {**record,'metricCoverageVersion':1,'metricCoverage':list(coverage.values())}


def save_source(record, path):
    path.parent.mkdir(parents=True,exist_ok=True)
    temporary=path.with_suffix('.tmp');temporary.write_text(json.dumps(record,ensure_ascii=False,indent=1)+'\n');temporary.replace(path)


def pack_source(index_path, source_root, output, selected_table=None):
    raw=index_path.read_bytes();record=json.loads(raw)
    if record.get('status')!='ready' or selected_table and record['table']['name']!=selected_table:return None
    table=record['table'];fields=table['columns'].split(',');packed_fields=[k for k in fields if k!='source_part']+['source_part']
    key=hashlib.sha256(record['source']['source_url'].encode()).hexdigest()
    previous=output/'sources'/(key+'.json')
    input_hash=hashlib.sha256(raw).hexdigest()
    if previous.exists():
        old=json.loads(previous.read_text())
        if old.get('inputSha256')==input_hash:
            for part in old['table']['parts'].values():
                path=output/part['url']
                if hashlib.file_digest(path.open('rb'),'sha256').hexdigest()!=part['sha256']:
                    raise ValueError('Packed section source hash mismatch')
            enriched=attach_metric_coverage(old,output)
            if enriched is not old:save_source(enriched,previous)
            return enriched
    writer=Packs(output,table['name'],packed_fields,key)
    coverage_groups={}
    # Source partitions already group event/UF/city/office. Sorting those keys lets
    # coverage keep one municipality's set of sections, never the whole archive.
    for part_key,part in sorted(table['parts'].items()):
        source_path=source_root/part['url']
        if hashlib.file_digest(source_path.open('rb'),'sha256').hexdigest()!=part['sha256']:
            raise ValueError('Input section source part hash mismatch')
        with gzip.open(source_path,'rt',encoding='utf8',newline='') as stream:
            for values in csv.reader(stream):
                row=dict(zip(fields,values));group=tuple(row[k] for k in ['election_id','state','city_code','office','office_key'])
                covered=coverage_groups.setdefault(group,{'sections':set(),'counts':Counter()})
                sections,counts=covered['sections'],covered['counts']
                sections.add((row['zone'],row['section']))
                if table['name'].endswith('votes'):counts[row['kind']]+=int(row['votes'])
                else:
                    for field in ['nominal_reported','legend_reported','blank','null_votes']:
                        if row.get(field)!='':counts[field]+=int(row[field])
                writer.write(row)
    coverage=[dict(election_id=g[0],state=g[1] or None,city_code=g[2],office=g[3],office_key=g[4],sections=len(c['sections']),counts=dict(c['counts']),countMeaning='observed_cast' if table['name'].endswith('votes') else 'reported_section_detail') for g,c in coverage_groups.items()]
    parts=writer.finish()
    if writer.rows!=record['rows']:raise ValueError('Repacking changed the number of source observations')
    packed_table={**table,'columns':','.join(packed_fields),'ddl':table['ddl'] if 'source_part' in fields else table['ddl'][:-1]+', source_part text)','parts':parts}
    result={**record,'inputSha256':input_hash,'table':packed_table,'transport':'UF/office packs; original section grain retained; source_part is the exact reload boundary.',
            'observedCoverage':coverage,'packedRows':writer.rows}
    result=attach_metric_coverage(result,output)
    save_source(result,previous)
    return result


def pack_job(path, source_root, output, selected_table=None):
    result=pack_source(path,source_root,output,selected_table)
    return dict(url=result['source']['source_url'],rows=result['packedRows'],parts=len(result['table']['parts'])) if result else None


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--input',type=pathlib.Path,required=True);parser.add_argument('--output',type=pathlib.Path,required=True)
    parser.add_argument('--workers',type=int,choices=range(1,5),default=1)
    parser.add_argument('--table',choices=['election_section_votes','election_section_units'])
    parser.add_argument('--source-url')
    args=parser.parse_args()
    paths=[args.input/'sources'/(hashlib.sha256(args.source_url.encode()).hexdigest()+'.json')] if args.source_url else sorted((args.input/'sources').glob('*.json'))
    with concurrent.futures.ProcessPoolExecutor(max_workers=args.workers) as pool:
        futures=[pool.submit(pack_job,path,args.input,args.output,args.table) for path in paths]
        for future in concurrent.futures.as_completed(futures):
            result=future.result()
            if result:print(json.dumps(result),flush=True)

if __name__=='__main__':main()
