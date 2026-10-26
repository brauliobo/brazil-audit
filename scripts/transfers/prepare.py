"""Source-first territorial reconciliation and explicit population scenarios."""
import numpy as np
from collections import defaultdict

CATEGORIES={'blank':'Brancos','null':'Nulos','null_technical':'Nulos técnicos','annulled':'Anulados','annulled_subjudice':'Anulados sub judice','annulled_separate':'Anulados em separado','annulled_urn':'Votos de seções anuladas','abstention':'Abstenção','not_installed':'Seções não instaladas','administrative_balance':'Saldo cadastral/territorial mínimo'}


def margins(units1,units2,scenario='minimum-registration-balance',turnover=0):
    matched=[];excluded=defaultdict(lambda:{'units':0,'electorate':0})
    keys=sorted(set(units1)|set(units2))
    observed={'first':0,'second':0,'minimumTerritorialChanges':0,'augmentedPopulation':0,'individualIdentityObserved':False}
    for key in keys:
        a,b=units1.get(key),units2.get(key)
        na=(a or {}).get('eligible') or 0;nb=(b or {}).get('eligible') or 0
        observed['first']+=na;observed['second']+=nb
        observed['minimumTerritorialChanges']+=abs(na-nb)
        reason=None
        if a is None or b is None:reason='missing_candidate_data'
        else:
            for q in [a,b]:
                fields=[q.get(f) for f in ['eligible','installed','present','absent']]
                if any(v is None for v in fields) or q.get('incomplete'):reason='missing_turnout_data';break
                if q['present']+q['absent']!=q['installed'] or q['installed']>q['eligible'] or sum(q['votes'].values())!=q['present']:
                    reason='inconsistent_margins';break
        if reason is None and scenario=='strict-compatible-totals' and na!=nb:reason='population_changed'
        if reason:
            excluded[reason]['units']+=1;excluded[reason]['electorate']+=max(na,nb)
            continue
        augmented=max(na,nb)+int(np.ceil(turnover*max(na,nb)))
        va=dict(a['votes']);vb=dict(b['votes'])
        for q,v in [(a,va),(b,vb)]:
            v['abstention']=q['absent'];v['not_installed']=q['eligible']-q['installed']
            v['administrative_balance']=augmented-q['eligible']
        observed['augmentedPopulation']+=augmented
        matched.append((key,va,vb))
    candidates1={k:v for q in units1.values() for k,v in q.get('candidates',{}).items()}
    candidates2={k:v for q in units2.values() for k,v in q.get('candidates',{}).items()}
    from_ids=sorted(set(k for _,a,_ in matched for k,n in a.items() if n>0))
    to_ids=sorted(set(k for _,_,b in matched for k,n in b.items() if n>0))
    x=np.array([[a.get(k,0) for k in from_ids] for _,a,_ in matched],dtype=np.int64)
    y=np.array([[b.get(k,0) for k in to_ids] for _,_,b in matched],dtype=np.int64)
    def categories(ids,total,meta):
        return [{'id':i,'label':CATEGORIES.get(i,meta.get(i,{}).get('label',i)),'total':int(n),**({'sourceCandidateId':meta[i].get('sourceCandidateId')} if i in meta else {})} for i,n in zip(ids,total)]
    covered_first=sum(units1[k]['eligible'] for k,_,_ in matched)
    denominator=max(observed['first'],observed['second'])
    coverage={'units':len(matched),'eligibleUnits':len(keys),'electorate':covered_first,'electorateTotal':observed['first'],
              'share':covered_first/observed['first'] if observed['first'] else 0,
              'secondElectorate':sum(units2[k]['eligible'] for k,_,_ in matched),
              'excluded':[{'reason':k,**v} for k,v in excluded.items()]}
    return {'x':x,'y':y,'from':categories(from_ids,x.sum(axis=0) if len(x) else [],candidates1),
            'to':categories(to_ids,y.sum(axis=0) if len(y) else [],candidates2),'coverage':coverage,'registration':observed,'unitKeys':[str(k) for k,_,_ in matched]}
