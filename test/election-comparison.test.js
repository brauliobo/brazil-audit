import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
import {METRICS} from '../src/comparison.js'
const source=readFileSync('src/election-comparison.js','utf8').replace(/^import .*\n/gm,'')
const m=await import(`data:text/javascript;base64,${Buffer.from(`const METRICS=${JSON.stringify(METRICS)};\n${source}`).toString('base64')}`)

test('native rates use explicit summed source denominators and preserve missing data',async()=>{
 const db=new PGlite()
 try{
  const request={sql:`select 20::bigint absent,100::bigint installed,2::bigint units,'state'::text grain`,params:[]}
  const q=m.nativeComparisonQuery('abstention_rate',request)
  const [row]=(await db.query(q.sql,q.params)).rows
  assert.equal(m.comparisonValue(m.comparisonMetric('abstention_rate'),row),0.2)
  const bad=m.nativeComparisonQuery('blank_rate',{sql:`select 10::bigint blank,null::bigint ballots,1::bigint units,'zone'::text grain`,params:[]})
  const [missing]=(await db.query(bad.sql,bad.params)).rows
  assert.equal(m.comparisonValue(m.comparisonMetric('blank_rate'),missing),null)
 }finally{await db.close()}
})
test('candidate comparisons retain source identities, full party labels and unknown registrations',async()=>{
 const db=new PGlite()
 try{
  await db.exec(`create table candidates(cand text,name text,short_name text,number text,party_label text,votes bigint,count_meaning text);
   insert into candidates values('eventA:source1','Alice','Alice','10','Partido completo',60,'reported_nominal'),('eventA:source2','Beto','Beto','20','Outro partido',40,'reported_nominal'),('eventA:registered','Cadastro','Cadastro','30',null,null,null);`)
  const request={sql:'select * from candidates',params:[]}
  const run=async(id,target)=>{const q=m.candidateComparisonQuery(id,request,target);return(await db.query(q.sql,q.params)).rows[0]}
  assert.equal(Number((await run('candidate_count')).numerator),2)
  assert.equal(Number((await run('party_count')).numerator),2)
  assert.equal(Number((await run('candidate_votes','eventA:source1')).numerator),60)
  assert.equal((await run('candidate_votes','eventB:source1')).numerator,null,'matching numbers in a different event are not candidate identity')
  await db.exec('delete from candidates where votes is not null')
  const row=await run('candidate_count')
  assert.equal(row.numerator,null)
  assert.equal(Number(row.records),0,'a known registration is not an observed zero vote count')
 }finally{await db.close()}
})
test('changes never compare incompatible count meanings',()=>{
 const rows=m.comparisonChanges([{value:10,comparability:'nominal-valid'},{value:100,comparability:'observed-cast'},{value:12,comparability:'nominal-valid'},{value:null,comparability:'nominal-valid'}])
 assert.deepEqual(rows.map(r=>r.change),[0,0,2,null])
})
