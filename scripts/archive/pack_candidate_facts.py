#!/usr/bin/env python3
"""Publishable bounded source-fact packs with explicit query capabilities and reload identities."""
import argparse,csv,gzip,hashlib,io,json,pathlib
from collections import defaultdict
from rollup_candidate_facts import NAMES

ELECTED={'ELEITO','ELEITO POR QE','ELEITO POR QP','ELEITO 1º TURNO QE','ELEITO 1º TURNO QP','ELEITO 2º TURNO'}
LOCAL={'11','12','13','25'}
ROLES={'election_vote_rollups':'aggregate-observation','election_votes':'zone-observation','election_candidates':'candidate-results','candidate_attributes':'candidate-attributes','candidate_identity':'identity-audit'}

class Packs:
    def __init__(self,output,table):
        self.output=output;self.table=table;self.fields=table['columns'].split(',');self.handles={};self.parts={};self.sequence=defaultdict(int)
    def close(self,key):
        a=self.handles.pop(key);a['stream'].close();a['file'].close();data=a['path'].read_bytes()
        if len(data)>=20*1024*1024:raise ValueError('A source-fact transport pack exceeds 20 MiB')
        self.parts[a['id']]={'url':str(a['path'].relative_to(self.output)),'rows':a['rows'],'bytes':len(data),'rawBytes':a['rawBytes'],'sha256':hashlib.sha256(data).hexdigest(),
          'where':"source_part = '"+a['id']+"'",'sourcePart':a['id'],'electionIds':sorted(a['events']),'officeKeys':sorted(a['offices']),'states':[key[1]],
          'sourceYears':[int(key[0])],'grains':sorted(a['grains']),'cities':sorted(a['cities']),'role':ROLES[self.table['name']]}
    def write(self,row):
        key=(str(row['source_year']),row['state'],row['office'])
        if key in self.handles and (self.handles[key]['rows']>=50000 or self.handles[key]['rawBytes']>=32*1024*1024):self.close(key)
        if key not in self.handles:
            n=self.sequence[key];self.sequence[key]+=1;part=f'{self.table["name"]}/{key[0]}/{key[1] or "unknown"}/{key[2] or "unknown"}/{n:05}'
            path=self.output/(part+'.csv.gz');path.parent.mkdir(parents=True,exist_ok=True);raw=path.open('wb')
            stream=io.TextIOWrapper(gzip.GzipFile(filename='',fileobj=raw,mode='wb',mtime=0,compresslevel=6),encoding='utf8',newline='')
            self.handles[key]={'id':part,'path':path,'file':raw,'stream':stream,'rows':0,'rawBytes':0,'events':set(),'offices':set(),'cities':set(),'grains':set()}
        a=self.handles[key];buffer=io.StringIO(newline='');csv.writer(buffer,lineterminator='\n').writerow([row.get(k) for k in self.fields]+[a['id']]);text=buffer.getvalue();a['stream'].write(text)
        a['rows']+=1;a['rawBytes']+=len(text.encode());a['events'].add(row['election_id']);a['offices'].add(row['office_key'])
        constituency=row.get('constituency') or ''
        grain=row.get('grain') or ('municipality' if constituency.isdigit() else 'national' if constituency=='br' else 'state' if constituency==row['state'] else 'unresolved_context');a['grains'].add(grain)
        city=row.get('city_code') or (constituency if constituency.isdigit() else '')
        if city:a['cities'].add(city)
    def finish(self):
        for key in list(self.handles):self.close(key)
        return {**self.table,'columns':self.table['columns']+',source_part','ddl':self.table['ddl'][:-1]+', source_part text)','parts':self.parts}

def build(facts,attributes,output,baseline=None,years=None,data_root=pathlib.Path('.cache/canonical-source-data')):
    raw_index=json.loads((facts/'index.json').read_text());attr_index=json.loads((attributes/'index.json').read_text())
    if years:
        for index in [raw_index,attr_index]:
            for table in index['tables'].values():table['parts']={k:v for k,v in table['parts'].items() if int(k.split('/')[0]) in years}
            index['events']=[e for e in index.get('events',[]) if e['source_year'] in years]
    indices=[raw_index,attr_index];tables={};events={};offices={};actual=defaultdict(lambda:{'rows':0,'votes':0})
    for index in indices:
        for e in index.get('events',[]):events.setdefault(e['election_id'],e)
    # Use the published summary index's official semantics for historical round availability.
    known={e['id']:e for e in json.load(open('data/history/indicators.json'))['elections']}
    for e in raw_index.get('eventOffices',[]):
        if years and e['election_id'] not in events:continue
        offices[(e['election_id'],e['office_key'])]={**e,'states':set(e['states']),'grains':set(e['grains']),'sources':set(),'statusKnown':set(),'electedIds':set(),'registeredIds':set(),'tables':set(e['tables'])}
    for index in indices:
        for table in index['tables'].values():
            writer=Packs(output,table);fields=table['columns'].split(',');rows=0
            for p in table['parts'].values():
                path=data_root/p['url']
                if hashlib.file_digest(path.open('rb'),'sha256').hexdigest()!=p['sha256']:raise ValueError('Source-fact input SHA mismatch')
                with gzip.open(path,'rt') as stream:
                    for values in csv.reader(stream):
                        if len(values)!=len(fields):raise ValueError('Source-fact column count mismatch')
                        r=dict(zip(fields,values));writer.write(r);rows+=1
                        k=(r['election_id'],r['office_key'])
                        e=offices.setdefault(k,{'election_id':k[0],'office':r['office'],'office_key':k[1],'office_name':NAMES.get(k[1],k[1].split(':',2)[-1]),'states':set(),'grains':set(),'sources':set(),'statusKnown':set(),'electedIds':set(),'registeredIds':set(),'tables':set(),'candidateCounts':False,'partyMetadata':False})
                        e['states'].add(r['state']);e['sources'].add(r['source_url']);e['tables'].add(table['name'])
                        if r['candidate_id'].startswith('record:'):
                            e.setdefault('unresolvedIds',set()).add(r['candidate_id'])
                            if r.get('status'):e.setdefault('knownOutcomeRecords',set()).add(r['candidate_id'])
                            if r.get('status','').upper() in ELECTED:e.setdefault('electedOutcomeRecords',set()).add(r['candidate_id'])
                        if table['name']=='candidate_attributes':
                            e['candidateAttributes']=True;e['registeredIds'].add(r['candidate_id']);e['partyMetadata']|=bool(r.get('party'))
                        if table['name'] in ['candidate_attributes','election_candidates'] and r['candidate_id'].startswith('candidate:'):
                            if r.get('status'):e['statusKnown'].add(r['candidate_id'])
                            if r.get('status','').upper() in ELECTED:e['electedIds'].add(r['candidate_id'])
                        if table['name']=='election_vote_rollups' and r.get('transit')!='S':
                            pair='|'.join([r['source_year'],r['election_id'].split(':')[2],r['state'],r['office'],r['kind']]);actual[pair]['rows']+=1;actual[pair]['votes']+=int(r['votes'])
            tables[table['name']]=writer.finish();print(json.dumps({'table':table['name'],'rows':rows,'parts':len(tables[table['name']]['parts'])}),flush=True)
    identity_fields=['election_id','candidate_id','state','office','office_key','source_record_id','identity_status','reported_constituency','source_url','source_sha256','source_member','source_row','source_year']
    identity_table={'name':'candidate_identity','columns':','.join(identity_fields),'ddl':'create table candidate_identity ('+', '.join(k+(' int' if k in ['source_row','source_year'] else ' text') for k in identity_fields)+')'}
    identity_writer=Packs(output,identity_table)
    for path in (data_root/'history/facts').glob('[12][0-9][0-9][0-9]/index.json'):
        if years and int(path.parent.name) not in years:continue
        for record in json.loads(path.read_text()).get('identityRecords',{}).values():identity_writer.write(record)
    tables['candidate_identity']=identity_writer.finish()
    event_offices=[]
    for e in offices.values():
        e['registeredCount']=len(e.pop('registeredIds'));e['statusKnownCount']=len(e.pop('statusKnown'));e['electedCount']=len(e.pop('electedIds'))
        legislative=e['office_key'] in ['senator','federal_deputy','state_deputy','district_deputy','councillor','historical:25:CONSELHEIRO DISTRITAL'] or e['office_key'].startswith('historical:6:DEPUTADO')
        e['unresolvedIdentityRecords']=len(e.pop('unresolvedIds',set()));e['contextUnresolved']=bool(e['unresolvedIdentityRecords'])
        e['statusKnownRecordCount']=len(e.pop('knownOutcomeRecords',set()));e['electedRecordCount']=len(e.pop('electedOutcomeRecords',set()))
        if e['contextUnresolved'] and not e.get('candidateCount'):e['candidateCount']=None
        e['elected']=bool((e['statusKnownCount'] or e['statusKnownRecordCount']) and legislative)
        from candidate_facts import office_jurisdiction
        e['constituencyGrain']=office_jurisdiction(e['office_key'])
        for name in ['states','grains','sources','tables']:e[name]=sorted(e[name])
        event_offices.append(e)
    canonical_events=[]
    for eid,e in events.items():
        existing=known.get(eid);event={'id':eid,'year':e['year'],'turn':existing['turn'] if existing else e['turn'],'description':e['description'],
          'dates':[e['date']] if e.get('date') else [],'electionTypes':[e['election_type']] if e.get('election_type') else [],'sourceElectionIds':[e['source_election_id']] if e.get('source_election_id') else [],
          'sourceDatasetYears':[e['source_year']],'sources':sorted({s for o in event_offices if o['election_id']==eid for s in o['sources']}),
          'offices':[{'id':o['office'],'key':o['office_key'],'name':o['office_name']} for o in event_offices if o['election_id']==eid]}
        canonical_events.append(event)
    audits=[]
    if baseline:
        secondary=json.loads(baseline.read_text())
        if years:secondary={k:v for k,v in secondary.items() if int(k.split('|')[0]) in years}
        missing=sorted(set(secondary)-actual.keys())
        for pair in sorted(set(secondary)|actual.keys()):
            a=actual.get(pair);b=secondary.get(pair)
            if a!=b:audits.append({'coverageKey':pair,'canonical':a,'territorialExport':b})
        if missing:raise ValueError(f'Canonical exports lose known office/UF/round coverage: {missing}')
    member_audits=[a for p in (data_root/'history/facts').glob('[12][0-9][0-9][0-9]/index.json') for a in json.loads(p.read_text()).get('memberAudits',[])]
    result={'version':1,'tables':tables,'eventOffices':event_offices,'events':canonical_events,'memberAudits':member_audits,'coverageDifferences':audits,
      'countMeaning':{'election_vote_rollups':'Reported aggregate candidate/list votes, with official valid destinations preserved where explicitly reported.','election_votes':'Original municipality/zone aggregate records; not individual votes or polling sections.','candidate_attributes':'Public nomination attributes; direct personal identifiers and exact birth dates are excluded.'}}
    output.mkdir(parents=True,exist_ok=True);(output/('index-'+'-'.join(str(y) for y in sorted(years))+'.json' if years else 'index.json')).write_text(json.dumps(result,ensure_ascii=False,indent=1)+'\n');return result
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--staging-root',type=pathlib.Path,default=pathlib.Path('.cache/canonical-source-data'));p.add_argument('--facts',type=pathlib.Path);p.add_argument('--attributes',type=pathlib.Path);p.add_argument('--output',type=pathlib.Path);p.add_argument('--baseline',type=pathlib.Path);p.add_argument('--years',type=int,nargs='+');a=p.parse_args();build(a.facts or a.staging_root/'history/result-facts',a.attributes or a.staging_root/'history/attributes',a.output or a.staging_root/'runtime-results',a.baseline,set(a.years) if a.years else None,a.staging_root)
