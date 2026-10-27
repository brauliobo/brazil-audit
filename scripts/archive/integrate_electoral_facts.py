#!/usr/bin/env python3
"""Integrate verified factual table fragments without reducing electoral identities."""
import argparse
import hashlib
import json
from pathlib import Path

from tse_archive import read_json, write_json


def fingerprint(manifest):
    evidence = {k: manifest.get(k) for k in ['tables','elections','profiles','electoralFacts']}
    return hashlib.sha256(json.dumps(evidence, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:20]


def canonical_events(records, offices, sources):
    """Adapt the explicit candidate-source event schema to the shared registry."""
    result=[]
    for record in records:
        if 'id' in record:
            result.append(record);continue
        required=['election_id','year','source_year','turn','date','description','election_type','source_election_id']
        for name in required:
            if name not in record:raise ValueError(f'candidate event metadata lacks {name}')
        descriptors=[dict(id=o['office'],key=o['office_key'],name=o['office_name'])
                     for o in offices if o['election_id']==record['election_id']]
        snapshots=[s for s in sources if s.get('source_year')==record['source_year']]
        urls=[record['source_url']] if record.get('source_url') else sorted({s['source_url'] for s in snapshots})
        date=record['date'];year=record['year']
        result.append(dict(id=record['election_id'],year=year,turn=record['turn'],description=record['description'],
            dates=[date] if date else [],electionTypes=[record['election_type']] if record['election_type'] else [],
            sourceElectionIds=[record['source_election_id']] if record['source_election_id'] else [],
            sourceDatasetYears=[record['source_year']],offices=record.get('offices') or descriptors,sources=urls,
            sourceProvenanceScope='record' if record.get('source_url') else 'source-year-collection',
            yearDateConflict=bool(date and int(date.split('/')[-1])!=year),parts=[]))
    return result


def merge_offices(registry, fragment):
    events = {e['id']: e for e in registry['events']}
    sessions = {s['key']: s for s in registry['sessions']}
    bindings = {(b['election_id'], b['office_key']): b for b in registry['bindings']}
    # Additional vote sources may use a different official event code from the
    # turnout source. Keep that code; a session groups sources, not fact rows.
    from build_election_registry import event_family, iso_date, constituency_grain
    context_bindings = {b['sourceEventId']: b for b in registry.get('sourceContextBindings', [])}
    for source_id, context in context_bindings.items():
        if context['matched'] != context['sourceRows'] or context['unmatchedOrAmbiguous']:
            raise ValueError('source context binding requires complete unambiguous source identity evidence')
        previous = events.get(source_id)
        target = events.get(context['targetEventId'])
        if previous and target:
            previous['sourceContextOnly'] = True
            previous['canonicalEventId'] = context['targetEventId']
            previous['contextBindingEvidence'] = context
            if previous['session_key'] != target['session_key']:
                old = sessions[previous['session_key']]
                old['eventIds'].remove(source_id)
                destination = sessions[target['session_key']]
                destination['eventIds'].append(source_id)
                previous['session_key'] = destination['key']
                for binding in registry['bindings']:
                    if binding['election_id'] == source_id:
                        binding['session_key'] = destination['key']
                if old['eventIds']:
                    raise ValueError('a bound source context must not remove unrelated session observations')
                registry['sessions'].remove(old)
                del sessions[old['key']]
    for source in fragment.get('events', []):
        if source['id'] in events:
            continue
        for required in ['year','turn','description','dates','electionTypes','sourceElectionIds','sourceDatasetYears','offices','sources']:
            if required not in source:
                raise ValueError(f'additional source event lacks explicit {required}')
        if not source['offices']:
            raise ValueError(f"additional source event needs actual office metadata: {source['id']}")
        dates = [iso_date(value) for value in source['dates']]
        if len(dates)>1:
            raise ValueError('additional source event spans distinct election dates')
        date=dates[0] if dates else None;family=event_family(source)
        # No date, or a supplementary contest without an exact event identity,
        # cannot establish equivalence with a separately reported pleito.
        context = context_bindings.get(source['id'])
        compatible=[s for s in sessions.values() if date and family in ['general','municipal']
                    and s['date']==date and s['turn']==source['turn'] and s['family']==family]
        if context:
            if context['matched'] != context['sourceRows'] or context['unmatchedOrAmbiguous']:
                raise ValueError('source context binding requires complete unambiguous source identity evidence')
            target = events.get(context['targetEventId'])
            if target is None:
                raise ValueError('source context binding target must be an observed electoral event')
            session = sessions[target['session_key']]
        elif len(compatible)==1:
            session=compatible[0]
        else:
            key='e-'+source['id'].replace(':','-')
            session=dict(key=key,year=int(date[:4]) if date else source['year'],calendarYear=int(date[:4]) if date else None,
                declaredYears=[source['year']],sourceYears=source['sourceDatasetYears'],date=date,turn=source['turn'],
                family=family,description=source['description'],label=source['description'] or key,legacyKey=None,eventIds=[],offices=[])
            registry['sessions'].append(session);sessions[key]=session
        session['eventIds'].append(source['id'])
        session['declaredYears']=sorted(set(session['declaredYears'])|{source['year']})
        session['sourceYears']=sorted(set(session['sourceYears'])|set(source['sourceDatasetYears']))
        event=dict(source,session_key=session['key'])
        if context:
            event['sourceContextOnly'] = True
            event['canonicalEventId'] = context['targetEventId']
            event['contextBindingEvidence'] = context
        registry['events'].append(event);events[event['id']]=event
    outcome_groups = {}
    for observed in fragment.get('eventOffices', []):
        eid = observed['election_id']; office_key = observed['office_key']
        if eid not in events:
            raise ValueError(f'candidate event needs explicit source event metadata before registry integration: {eid}')
        event = events[eid]; session = sessions[event['session_key']]
        office = next((o for o in session['offices'] if o['key'] == office_key), None)
        if office is None:
            office = dict(id=observed['office'], key=office_key, name=observed['office_name'],
                capabilities=dict(metrics={},grains=[],states=[],tables=[],rows=0,sectionResults=False,browserRdv=False,times=False))
            session['offices'].append(office)
        office['constituencyGrain']=constituency_grain(office,event)
        office['constituencyEvidence']=dict(kind='source-office-role',officeKey=office_key,officeName=office['name'])
        if not any(o['key'] == office_key for o in event['offices']):
            event['offices'].append(dict(id=observed['office'],key=office_key,name=observed['office_name']))
        cap = office['capabilities']
        cap.setdefault('unitStates',list(cap['states']))
        cap['states']=sorted(set(cap['states'])|set(observed['states']))
        reported_grain=observed.get('constituencyGrain')
        if reported_grain:
            cap['sourceProfileConstituencyGrains']=sorted(set(cap.get('sourceProfileConstituencyGrains',[]))|{reported_grain})
            cap['constituencyContextResolved']=not observed.get('contextUnresolved',False) and reported_grain==office['constituencyGrain'] and reported_grain!='unknown'
        cap['candidateCounts'] = bool(cap.get('candidateCounts') or observed.get('candidateCounts'))
        if 'candidateCount' in observed:
            previous=cap.get('candidateCount',0);current=observed['candidateCount']
            cap['candidateCount']=None if previous is None or current is None else previous+current
        cap['partyMetadata'] = bool(cap.get('partyMetadata') or observed.get('partyMetadata'))
        cap['tables'] = sorted(set(cap['tables']) | set(observed['tables']))
        roles=cap.setdefault('sources', {})
        vote_tables=set(observed['tables']) & {'election_votes','election_vote_rollups'}
        section_tables=set(observed['tables']) & {'election_section_votes','election_section_units'}
        if vote_tables:
            cap['voteRows']=cap.get('voteRows',0)+observed.get('rows',0)
            cap['voteGrains'] = sorted(set(cap.get('voteGrains',[])) | set(observed['grains']))
            cap['voteStates'] = sorted(set(cap.get('voteStates',[])) | set(observed['states']))
            roles['votes'] = dict(tables=sorted(vote_tables),grains=observed['grains'],states=observed['states'])
        if section_tables:
            if 'election_section_votes' in section_tables:
                cap['sectionResults']=True
                roles['observedSections']=dict(tables=['election_section_votes'],grains=observed['grains'],states=observed['states'],
                    countMeaning=observed['countMeaning'],coverageByState=observed.get('coverageByState',[]))
            if 'election_section_units' in section_tables:
                roles['sectionReference']=dict(table='election_section_units',grains=observed['grains'],states=observed['states'],
                    metrics=observed.get('metrics',{}),rows=observed.get('rows'),coverageByState=observed.get('coverageByState',[]))
        if 'candidate_attributes' in observed['tables']:
            cap['candidateAttributes']=True
            roles['candidateAttributes']=dict(table='candidate_attributes',states=observed['states'],
                constituencyGrain=office['constituencyGrain'])
        if observed.get('elected'):
            cap['elected']=True
        if 'candidate_attributes' in observed['tables'] and observed.get('registeredCount') is not None:
            cap['registeredCount']=cap.get('registeredCount',0)+observed['registeredCount']
        identity_event=context_bindings.get(eid,{}).get('targetEventId',eid)
        outcome_groups.setdefault((session['key'],office_key,identity_event),[]).append(observed)
        for count in ['unresolvedIdentityRecords','statusKnownRecordCount','electedRecordCount']:
            if count in observed:
                cap[count]=cap.get(count,0)+observed[count]
        if observed.get('contextUnresolved'):
            cap['identityContextUnresolved']=True
        binding = bindings.get((eid,office_key))
        if binding is None:
            binding = dict(session_key=session['key'],election_id=eid,office_key=office_key,sources={})
            bindings[(eid,office_key)] = binding; registry['bindings'].append(binding)
        for name in observed['tables']:
            binding['sources'][name] = dict(table=name,election_id=eid)
    totals={}
    for (session_key,office_key,event_id),providers in outcome_groups.items():
        target=totals.setdefault((session_key,office_key),dict(statusKnownCount=[],electedCount=[]))
        for count in target:
            known={p[count] for p in providers if p.get(count) is not None and not p.get('contextUnresolved')}
            if len(known)>1:
                raise ValueError(f'linked source contexts report inconsistent {count}: {event_id}')
            if known:target[count].append(known.pop())
    for (session_key,office_key),counts in totals.items():
        cap=next(o['capabilities'] for o in sessions[session_key]['offices'] if o['key']==office_key)
        for count,values in counts.items():cap[count]=sum(values) if values else None
    return registry


def election_stages(registry):
    """Counts, registration and reported outcomes are independent source dimensions."""
    for session in registry['sessions']:
        stages=[]
        for office in session['offices']:
            cap=office['capabilities']
            sources=cap.get('sources',{})
            reference_rows=sources.get('sectionReference',{}).get('rows') or 0
            observed=cap.get('rows',0)>0 or cap.get('voteRows',0)>0 or bool(sources.get('observedSections')) or reference_rows>0
            registered=cap.get('candidateAttributes') and cap.get('registeredCount',0)>0
            reported_outcomes=bool(cap.get('statusKnownCount') or cap.get('statusKnownRecordCount'))
            outcome_people=bool(cap.get('statusKnownCount')) and not cap.get('identityContextUnresolved',False)
            stage='observedData' if observed else 'registrationWithOutcomes' if registered and reported_outcomes else 'registrationOnly' if registered else 'unknown'
            office['electionStage']=stage;stages.append(stage)
            office['availability']=dict(counts=observed,registration=bool(registered),reportedOutcomes=reported_outcomes,resolvedOutcomePeople=outcome_people)
            cap['outcomeKnown']=outcome_people
        session['electionStage']=next((stage for stage in ['observedData','registrationWithOutcomes','registrationOnly'] if stage in stages),'unknown')
        session['availability']={key:any(o['availability'][key] for o in session['offices']) for key in ['counts','registration','reportedOutcomes','resolvedOutcomePeople']}
    return registry


def date_evidence(registry):
    """A registration snapshot's declared date is not proof of voting on that date."""
    bindings={}
    for binding in registry['bindings']:
        bindings.setdefault(binding['election_id'],set()).update(binding['sources'])
    events={e['id']:e for e in registry['events']}
    count_tables={'units','election_units','election_votes','election_vote_rollups','election_section_votes','election_section_units'}
    for event in events.values():
        tables=bindings.get(event['id'],set())
        if event.get('sourceContextOnly'):
            evidence='candidate-identity-linked-to-voting-source'
        elif tables & count_tables:
            evidence='voting-source-reported'
        elif 'candidate_attributes' in tables:
            evidence='registration-source-reported'
        else:
            evidence='source-reported'
        event['dateEvidence']=evidence
    for session in registry['sessions']:
        observed={events[eid]['dateEvidence'] for eid in session['eventIds']}
        session['dateMeaning']='voting-source-reported' if observed & {'voting-source-reported','candidate-identity-linked-to-voting-source'} else 'source-context-reported'
    return registry


def nomination_references(registry,fragment,index):
    """Expose source-year references independently of observed election counts."""
    names={'election_lists','election_declared_seats','candidate_list_links'}
    if not names.intersection(fragment['tables']):return
    sessions={s['key']:s for s in registry['sessions']};available=set();bridges={}
    from build_election_registry import iso_date
    seats=fragment['tables'].get('election_declared_seats',{}).get('parts',{})
    for part in seats.values():
        canonical=set(part['officeKeys'])
        for year in part['sourceYears']:
            if year<1994:continue
            for raw in part['officeKeys']:
                pieces=raw.split(':',2)
                if len(pieces)!=3 or pieces[0]!='historical' or pieces[1] not in ['9','10']:continue
                code=pieces[1]
                observed=[(e,o) for e in registry['events'] if year in e['sourceDatasetYears'] for o in e['offices'] if str(o['id'])==code]
                keys={o['key'] for e,o in observed}
                if len(keys)!=1:raise ValueError('modern alternate cargo code needs one explicit source-year identity')
                office=next(iter(keys));canonical.add(office)
                if office==raw:continue
                refs=[dict(id=e['id'],code=c,date=iso_date(d),sessionKey=e['session_key']) for e,o in observed for c in e['sourceElectionIds'] for d in e['dates']]
                bridges[(year,raw)]=dict(sourceYear=year,office=code,rawOfficeKey=raw,officeKey=office,
                    evidence='same-source-year-official-cargo-code',tables=['election_declared_seats'],events=refs)
        part['canonicalOfficeKeys']=sorted(canonical)
    for name in names.intersection(fragment['tables']):
        for part in fragment['tables'][name]['parts'].values():
            available.update(part['sourceYears'])
            for key in part['sessionKeys']:
                session=sessions[key]
                for office in session['offices']:
                    if office['key'] not in part.get('canonicalOfficeKeys',part['officeKeys']):continue
                    cap=office['capabilities'];role=cap.setdefault('sources',{}).setdefault('nominations',dict(index=index,bindingKind='source-year-reference',tables=[],sourceYears=[]))
                    role['tables']=sorted(set(role['tables'])|{name});role['sourceYears']=sorted(set(role['sourceYears'])|set(part['sourceYears']))
                    aliases={b['rawOfficeKey'] for (year,raw),b in bridges.items() if year in part['sourceYears'] and b['officeKey']==office['key']}
                    role['sourceOfficeKeys']=sorted(set(role.get('sourceOfficeKeys',[]))|{office['key']}|aliases)
                    flag={'election_lists':'listMetadata','election_declared_seats':'declaredSeats','candidate_list_links':'candidateListLinks'}[name]
                    cap[flag]=True
    registry['nominations']=dict(index=index,tables=sorted(names.intersection(fragment['tables'])),availableYears=sorted(available),officeBindings=list(bridges.values()),scope='Source-year reference or explicitly identified source event; declared vacancies are not observed outcomes.')


def integrate(data_dir, fragment_paths):
    manifest_path = data_dir/'manifest.json';manifest=read_json(manifest_path)
    registry_path = data_dir/'elections.json';registry=read_json(registry_path)
    context_path = data_dir/'election-source-bindings.json'
    if context_path.exists():
        registry['sourceContextBindings'] = read_json(context_path)
    # Repeated integration replaces per-event candidate capabilities, not additive
    # counters from a previous rendering of the very same source fragment.
    for session in registry['sessions']:
        for office in session['offices']:
            for key in ['candidateCounts','candidateCount','partyMetadata','voteGrains','voteStates','candidateAttributes',
                        'elected','registeredCount','statusKnownCount','electedCount','sourceProfileConstituencyGrains','constituencyContextResolved',
                        'unresolvedIdentityRecords','statusKnownRecordCount','electedRecordCount','identityContextUnresolved','voteRows','outcomeKnown']:
                office['capabilities'].pop(key,None)
    combined=dict(events=[],eventOffices=[],sources=[],places=[],observedBallotOptions=[])
    for path in fragment_paths:
        fragment=read_json(path)
        for name, table in fragment['tables'].items():
            if table['name']!=name or not table['ddl'].startswith(f'create table {name} ('):
                raise ValueError('factual fragment table name and schema disagree')
            manifest['tables'][name]=table
        for name in combined:combined[name].extend(fragment.get(name,[]))
    combined['events']=canonical_events(combined['events'],combined['eventOffices'],combined['sources'])
    merge_offices(registry,combined)
    if registry.get('sourceContextBindings'):
        from election_places import rebind_source_contexts
        rebind_source_contexts(data_dir,registry,manifest)
    if combined['places']:
        from election_places import merge_descriptors
        merge_descriptors(data_dir,registry,manifest,combined['places'])
    if combined['observedBallotOptions']:
        registry['observedBallotOptions']=combined['observedBallotOptions']
    for path in fragment_paths:
        if path.name=='index.json' and path.parent.name=='nominations':
            nomination_references(registry,dict(tables={name:manifest['tables'][name] for name in ['election_lists','election_declared_seats','candidate_list_links']}),str(path.relative_to(data_dir)))
    election_stages(registry)
    date_evidence(registry)
    registry['counts'].update(sessions=len(registry['sessions']),events=len(registry['events']))
    manifest['elections']=dict(index='elections.json',**registry['counts'])
    if registry.get('nominations'):manifest['nominations']=registry['nominations']
    relative=[str(path.relative_to(data_dir)) for path in fragment_paths]
    manifest['electoralFacts']=dict(indexes=relative)
    if manifest.get('geo'):
        manifest['geo']['sourceReference'] = dict(
            kind='present-day-reference', referenceYear=None, historicalBoundaries=False,
            sources=[
                'https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR?qualidade=minima&intrarregiao=UF&formato=application/json',
                'https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR?qualidade=minima&intrarregiao=municipio&formato=application/json'],
            municipalityMapping=dict(referenceYear=2026, historicalCrosswalk=False,
                source='https://resultados.tse.jus.br/oficial/ele2026/6257/config/mun-e006257-cm.json'),
            note='Reference outlines were fetched without a historical period. Matching a UF or municipality code does not establish equivalent historical boundaries.')
    manifest['version']=manifest['version'].split('+')[0]+'+facts-'+fingerprint(manifest)
    from browser_catalog import update
    update(data_dir,registry,fragment_paths)
    write_json(registry_path,registry)
    manifest_path.write_text(json.dumps(manifest,ensure_ascii=False,indent=1)+'\n')
    return manifest


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--data-dir',type=Path,default=Path('data'))
    parser.add_argument('--fragment',type=Path,action='append',required=True);args=parser.parse_args()
    result=integrate(args.data_dir,args.fragment);print(result['version'])
