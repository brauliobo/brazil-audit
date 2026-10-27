"""Resolve exact repeated reference observations across official ZIP representations."""
import csv
import gzip
import hashlib
import json
import pathlib
from collections import Counter, defaultdict
from build_election_registry import NUMERIC

VERSION = 1
CODE_SHA = hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest()
KEY_FIELDS = ['election_id','office_key','state','city_code','zone','section','transit']
PROVENANCE_FIELDS = {'source_member','source_part','session_key'}
MEASURES = sorted(NUMERIC | {'nominal_reported','legend_reported'})


def member_role(member):
    token=pathlib.PurePosixPath(member).stem.rsplit('_',1)[-1].upper()
    return 'national-native' if token=='BRASIL' else 'national' if token=='BR' else 'state' if len(token)==2 else 'other'


def priority(row):
    # Preference applies only after exact equality of every published measure.
    return ({'national-native':0,'state':1,'national':2,'other':3}[member_role(row['source_member'])],row['source_member'])


def signature(row):
    return tuple(row.get(k,'') for k in MEASURES)


def merge_observation(observations, row, audit):
    key=tuple(row.get(k,'') for k in KEY_FIELDS)
    previous=observations.get(key)
    member=row['source_member']
    audit['members'].setdefault(member,dict(role=member_role(member),inputRows=0,selectedRows=0))['inputRows']+=1
    if previous is None:
        observations[key]=row
        return
    if signature(previous)!=signature(row):
        differences={k:[previous.get(k),row.get(k)] for k in MEASURES if previous.get(k)!=row.get(k)}
        raise ValueError(json.dumps(dict(reason='Conflicting section reference measures',key=dict(zip(KEY_FIELDS,key)),members=[previous['source_member'],member],differences=differences),ensure_ascii=False))
    pair=tuple(sorted([previous['source_member'],member]))
    audit['overlaps'][pair]+=1
    audit['duplicateRows']+=1
    if priority(row)<priority(previous):observations[key]=row


def reconcile(record, input_root, output_root):
    from section_facts import PartitionWriter, UNIT_TABLE
    if record.get('referenceMemberSelection',{}).get('version')==VERSION:return record
    table=record['table'];fields=table['columns'].split(',')
    if table['name']!=UNIT_TABLE:raise ValueError('Reference member reconciliation accepts reference facts only')
    groups=defaultdict(list)
    for part in table['parts'].values():
        buckets={int(city)%64 for city in part['cities'] if city}
        if len(buckets)!=1 or len(part['states'])!=1 or len(part['offices'])!=1:
            raise ValueError('Reference source partition does not declare one state/office/city bucket')
        groups[(part['states'][0] or '',str(part['offices'][0]),next(iter(buckets)))].append(part)
    writer=PartitionWriter(output_root,[f for f in fields if f!='source_part'],UNIT_TABLE,record['source'])
    audit=dict(version=VERSION,codeSha256=CODE_SHA,inputRows=0,uniqueRows=0,duplicateRows=0,members={},overlaps=Counter(),conflicts=0)
    for group,parts in sorted(groups.items()):
        observations={}
        for part in parts:
            path=input_root/part['url']
            if hashlib.file_digest(path.open('rb'),'sha256').hexdigest()!=part['sha256']:
                raise ValueError('Reference input changed before member reconciliation')
            with gzip.open(path,'rt',encoding='utf8',newline='') as stream:
                for values in csv.reader(stream):
                    row=dict(zip(fields,values))
                    if (row['state'],row['office'],int(row['city_code'])%64)!=group:
                        raise ValueError('Reference observation does not match its declared partition')
                    merge_observation(observations,row,audit);audit['inputRows']+=1
        for key,row in sorted(observations.items()):
            writer.write(row);audit['uniqueRows']+=1
            audit['members'][row['source_member']]['selectedRows']+=1
    parts=writer.finish()
    if audit['inputRows']!=record['rows'] or audit['uniqueRows']+audit['duplicateRows']!=audit['inputRows']:
        raise ValueError('Reference reconciliation did not account for every input observation')
    audit['overlaps']=[dict(members=list(k),rows=v) for k,v in audit['overlaps'].items()]
    return {**record,'rows':audit['uniqueRows'],'referenceMemberSelection':audit,
        'counts':[dict(election_id=k[0],state=k[1],office=k[2],kind=k[3],count=v) for k,v in writer.counts.items()],
        'table':{**table,'columns':','.join(writer.fields),'parts':parts}}
