import test from 'node:test'
import assert from 'node:assert/strict'
import {candidateAnalysisScope,candidateDistribution,analysisDefaultState,analysisDefaultGrain} from '../src/analysis-context.js'

test('candidate distributions exclude every off-ballot state and municipality before constructing zeros',()=>{
 const gov={constituencyGrain:'state'},candidate={cand:'sp/13',state:'sp',identity_status:'context_resolved'}
 const rows=[{id:'ac',state:'ac',cand:'ac/13',votes:50,candidate_total:100},{id:'sp/one',state:'sp',cand:'sp/13',votes:0,candidate_total:100},{id:'sp/two',state:'sp',cand:'other',votes:100,candidate_total:100,nominal_valid:100,count_meaning:'official_nominal_valid'}]
 const result=candidateDistribution(rows,gov,candidate,{})
 assert.equal(result.length,2);assert.ok(result.every(r=>r.state==='sp'));assert.deepEqual(result.map(r=>r.votes),[0,0])
 const mayor={constituencyGrain:'municipality'},local={cand:'local',state:'sp',city_code:'00100',identity_status:'context_resolved'}
 assert.deepEqual(candidateAnalysisScope(mayor,local,{}),{state:'sp',city_code:'00100'})
 assert.equal(candidateDistribution([{id:'elsewhere',state:'sp',city_code:'00200',cand:'other',votes:1}],mayor,local,{}).length,0)
 assert.equal(candidateAnalysisScope(mayor,{...local,city_code:null,identity_status:'context_unresolved'},{}),null)
})
test('a missing candidate record is unknown unless the reported unit total proves complete coverage',()=>{
 const office={constituencyGrain:'national'},candidate={cand:'a',state:'br'}
 const [r]=candidateDistribution([{id:'sp',state:'sp',cand:'b',votes:10,candidate_total:10}],office,candidate,{})
 assert.equal(r.votes,null);assert.equal(r.share,null)
})
test('defaults choose an importable fine unit within budget and use all UFs for coarse-only sources',()=>{
 const office={capabilities:{states:['ac','sp'],voteGrains:['state']}}
 assert.equal(analysisDefaultState(office,null),'br')
 assert.equal(analysisDefaultGrain(['state','zone','section'],null,'ac',{section:100000,zone:10000}),'section')
 assert.equal(analysisDefaultGrain(['state','zone','section'],null,'br',{section:100000,zone:10000}),'zone')
 assert.equal(analysisDefaultGrain(['state','zone','section'],null,'sp',{section:50e6,zone:500000}),'zone')
})
