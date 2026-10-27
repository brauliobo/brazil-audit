import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'

const source=(await readFile(new URL('../src/election-results.js',import.meta.url),'utf8')).replace(/^import .*\n/gm,'')
const cfg={historic:{sourceSession:{key:'historic',eventIds:['e'],sourceYears:[1933]},officeDefinitions:[{id:'6',key:'historical:6:DEPUTADO',constituencyGrain:'state'}],offices:[6]}}
cfg.future={sourceSession:{key:'future',eventIds:['2024:6295:1:2026-12-06'],sourceYears:[2024]},offices:[11,12],officeDefinitions:[{id:'11',key:'mayor',constituencyGrain:'municipality',electionStage:'registrationOnly',capabilities:{candidateAttributes:true}},{id:'12',key:'historical:12:VICE-PREFEITO',constituencyGrain:'municipality',electionStage:'registrationOnly',capabilities:{candidateAttributes:true}}]}
cfg.modern={year:2026,turn:2,legacyKey:'modern',sourceSession:{key:'modern',eventIds:['gov'],sourceYears:[2026]},offices:[3],officeDefinitions:[{id:'3',key:'governor',constituencyGrain:'state'}]}
cfg.nativeRoster={...cfg.future,legacyKey:'modern'}
const adapter=await import(`data:text/javascript;base64,${Buffer.from(`const ELECTIONS=${JSON.stringify(cfg)};const NATIVE_ELECTIONS={modern:{offices:[3]}};const SOURCE_BINDINGS=[];const rollup=()=>({res:'res',tot:'tot'});\n${source}`).toString('base64')}`)

test('official totals retain coverage, candidate grain may be finer, unknown is not zero',async()=>{
 const db=new PGlite()
 try{
  await db.exec(`create table election_units(election_id text,office_key text,state text,city_code text,zone text,section text,grain text,transit text,nominal bigint,legend bigint,sections bigint,valid bigint,blank bigint,null_votes bigint,ballots bigint,eligible bigint,installed bigint,present bigint,absent bigint,not_installed bigint,source_url text,source_sha256 text);
   create table election_vote_rollups(election_id text,office text,office_key text,state text,city_code text,zone text,section text,grain text,transit text,candidate_id text,number text,kind text,votes bigint,destination text,constituency text);
   create table election_places(session_key text,state text,city_code text,city_name text);insert into election_places values('historic','ac','00100','Primeira'),('historic','ac','00200','Segunda');
   create table candidate_identity(election_id text,candidate_id text,identity_status text,source_record_id text);
   create table election_candidates(election_id text,candidate_id text,state text,name text,short_name text,party text,office_key text,number text,constituency text,status text,source_url text,party_name text);`)
  await db.exec(`insert into election_units values
   ('e','historical:6:DEPUTADO','ac',null,null,null,'state',null,180,0,10,180,10,10,200,120,120,100,20,0,'official','hash'),
   ('e','historical:6:DEPUTADO','ac','00100','0001',null,'zone','N',18,0,1,18,1,1,20,12,12,10,2,0,'partial-zone','hash'),
   ('e','historical:6:DEPUTADO','rb',null,null,null,'state',null,null,null,3,null,null,null,null,null,null,null,null,null,'legacy','hash');
   insert into election_vote_rollups values
   ('e','6','historical:6:DEPUTADO','ac','00100','0001',null,'zone','N','a','10','candidate',100,'valid','ac'),
   ('e','6','historical:6:DEPUTADO','ac','00200','0002',null,'zone','N','a','10','candidate',80,'valid','ac'),
   ('other','6','historical:6:DEPUTADO','ac','00100','0001',null,'zone','N','a','10','candidate',9999,'valid','ac');
   create table election_votes as select * from election_vote_rollups;
   insert into election_candidates values ('e','a','ac','Alice','Alice',null,'historical:6:DEPUTADO','10','ac',null,'source','PARTIDO SOCIAL DEMOCRÁTICO');`)
  await db.exec('alter table election_units add column null_total bigint,add column null_technical bigint,add column annulled bigint,add column annulled_subjudice bigint,add column annulled_separate bigint')
  const query=async fn=>{const {sql,params}=fn;return(await db.query(sql,params)).rows}
  let [r]=await query(adapter.totalsSql('historic',6,{state:'ac'}))
  assert.equal(Number(r.valid),180,'state totals win over partial zone rollup')
  assert.equal(Number(r.present),100);assert.equal(Number(r.ballots),200,'Senate-like ballot counts need not equal attendance')
  const [candidate]=await query(adapter.candidatesSql('historic',6,{state:'ac'}))
  assert.equal(candidate.party_label,'PARTIDO SOCIAL DEMOCRÁTICO');assert.equal(Number(candidate.votes),180,'finer candidate units aggregate without repeating population or crossing pleitos')
  const paged=await query(adapter.candidatesSql('historic',6,{state:'ac'},{limit:1,offset:0}));assert.equal(Number(paged[0].total_rows),1)
  const units=await query(adapter.unitsSql('historic',6,'municipality',{state:'ac'}))
  assert.equal(units.length,2);assert.equal(Number(units.find(u=>u.city_code==='00100').eligible),12,'published zone metrics remain observed within their city');assert.equal(units.find(u=>u.city_code==='00200').eligible,null,'no population is invented for another city');assert.ok(units.every(u=>u.eligible==null||Number(u.eligible)!==120),'state population is never copied to a city')
  ;[r]=await query(adapter.totalsSql('historic',6,{state:'rb'}));assert.equal(r.blank,null);assert.equal(r.present,null)
  const empty=await query(adapter.candidatesSql('historic',6,{state:'ac',city_code:'99999'}));assert.equal(empty.length,1);assert.equal(empty[0].votes,null,'known nominees remain visible without inventing votes in an unreported city')
  await db.exec("insert into election_units select election_id,office_key,'br',null,null,null,'national',null,nominal,legend,sections,valid,blank,null_votes,ballots,eligible,installed,present,absent,not_installed,source_url,source_sha256 from election_units where state='ac' and grain='state'")
  ;[r]=await query(adapter.totalsSql('historic',6,{}));assert.equal(Number(r.eligible),120,'national reference excludes every state/territory descendant')
  ;[r]=await query(adapter.totalsSql('historic',6,{state:'ac'}));assert.equal(Number(r.eligible),120,'state query excludes the national ancestor outside its context')
 }finally{await db.close()}
})

 test('modern gubernatorial candidates keep state identity when ballot numbers repeat',async()=>{
 const db=new PGlite()
 try{
 await db.exec(`create table election_units(election_id text,office_key text,state text,city_code text,zone text,section text,grain text,transit text,nominal bigint,legend bigint,sections bigint,valid bigint,blank bigint,null_votes bigint,ballots bigint,eligible bigint,installed bigint,present bigint,absent bigint,not_installed bigint);
 insert into election_units values('gov','governor','ac',null,null,null,'state',null,30,0,2,30,2,3,35,40,40,35,5,0),('gov','governor','am',null,null,null,'state',null,40,0,2,40,4,6,50,60,60,50,10,0);
 create table mun_map(state text,city text,tse text);insert into mun_map values('ac','a','00100'),('ac','b','00200'),('am','c','00300');
 create table res(election int,turn int,state text,city text,office int,cand text,votes bigint);
 create table cands(election int,turn int,office int,n text,uf text,name text,short_name text,party text);
 insert into res values(2026,2,'ac','a',3,'13',10),(2026,2,'ac','b',3,'13',20),(2026,2,'am','c',3,'13',40);
 insert into cands values(2026,2,3,'13','ac','A','A','P'),(2026,2,3,'13','am','B','B','P');`)
 let q=adapter.candidatesSql('modern','governor');const candidates=(await db.query(q.sql,q.params)).rows
 assert.equal(candidates.length,2);assert.deepEqual(candidates.map(r=>r.cand),['am/13','ac/13']);assert.deepEqual(candidates.map(r=>Number(r.votes)),[40,30])
 q=adapter.unitsSql('modern','governor','state');const units=(await db.query(q.sql,q.params)).rows
 assert.equal(units.length,2);assert.equal(units.find(r=>r.state==='ac').cand,'ac/13');assert.equal(Number(units.find(r=>r.state==='ac').votes),30);assert.equal(Number(units.find(r=>r.state==='ac').blank),2);assert.equal(Number(units.find(r=>r.state==='am').present),50);assert.equal(Number(units.find(r=>r.state==='am').ballots),50)
 }finally{await db.close()}
 })

 test('actual future registrations expose nominees with unknown votes and no inferred outcome',async()=>{
 const db=new PGlite()
 try{
  const manifest=JSON.parse(await readFile(new URL('../data/manifest.json',import.meta.url),'utf8'))
  for(const name of ['election_units','election_vote_rollups','election_candidates','candidate_attributes','candidate_identity','election_places'])await db.exec(manifest.tables[name].ddl)
  const meta=JSON.parse(await readFile(new URL('./archive/fixtures/candidate-future-registration.json',import.meta.url),'utf8'))
  const csv=await readFile(new URL('./archive/fixtures/candidate-future-registration.csv',import.meta.url))
  await db.exec(`copy candidate_attributes (${meta.columns.join(',')}) from '/dev/blob' csv header`,{blob:new Blob([csv])})
  assert.ok(!adapter.candidatesSql('nativeRoster','mayor',{state:'ma'}).sql.includes('from res u'),'native source dispatcher is per office, not per session')
  for(const office of ['mayor','historical:12:VICE-PREFEITO']){
   let q=adapter.candidatesSql('future',office,{state:'ma'});let rows=(await db.query(q.sql,q.params)).rows
   assert.equal(rows.length,2);assert.ok(rows.every(r=>r.votes===null&&r.candidate_total===null),'registration does not become zero votes')
   q=adapter.rosterSql('future',office,{state:'ma'});rows=(await db.query(q.sql,q.params)).rows
   assert.equal(rows.length,2);assert.ok(rows.every(r=>r.is_elected===null&&r.election_stage==='registrationOnly'))
  }
  await db.exec("update candidate_attributes set status='ELEITO' where office_key='historical:12:VICE-PREFEITO'")
  const q=adapter.rosterSql('future','historical:12:VICE-PREFEITO',{state:'ma'});assert.ok((await db.query(q.sql,q.params)).rows.every(r=>r.is_elected===true),'an explicit vice outcome does not require personal votes')
 }finally{await db.close()}
 })
