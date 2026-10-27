import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'

const source=(await readFile(new URL('../src/election-results.js',import.meta.url),'utf8')).replace(/^import .*\n/gm,'')
const cfg={historic:{sourceSession:{key:'historic',eventIds:['e'],sourceYears:[1933]},officeDefinitions:[{id:'6',key:'historical:6:DEPUTADO'}],offices:[6]}}
cfg.modern={year:2026,turn:2,offices:[3],officeDefinitions:[{id:'3',key:'governor'}]}
const adapter=await import(`data:text/javascript;base64,${Buffer.from(`const ELECTIONS=${JSON.stringify(cfg)};const rollup=()=>({res:'res',tot:'tot'});\n${source}`).toString('base64')}`)

test('official totals retain coverage, candidate grain may be finer, unknown is not zero',async()=>{
 const db=new PGlite()
 try{
  await db.exec(`create table election_units(election_id text,office_key text,state text,city_code text,zone text,section text,grain text,transit text,nominal bigint,legend bigint,sections bigint,valid bigint,blank bigint,null_votes bigint,ballots bigint,eligible bigint,installed bigint,present bigint,absent bigint,not_installed bigint,source_url text,source_sha256 text);
   create table election_votes(election_id text,office_key text,state text,city_code text,zone text,section text,grain text,transit text,candidate_id text,number text,kind text,votes bigint);
   create table election_candidates(election_id text,candidate_id text,state text,name text,short_name text,party text);`)
  await db.exec(`insert into election_units values
   ('e','historical:6:DEPUTADO','ac',null,null,null,'state',null,180,0,10,180,10,10,200,120,120,100,20,0,'official','hash'),
   ('e','historical:6:DEPUTADO','ac','00100','0001',null,'zone','N',18,0,1,18,1,1,20,12,12,10,2,0,'partial-zone','hash'),
   ('e','historical:6:DEPUTADO','rb',null,null,null,'state',null,null,null,3,null,null,null,null,null,null,null,null,null,'legacy','hash');
   insert into election_votes values
   ('e','historical:6:DEPUTADO','ac','00100','0001',null,'zone','N','a','10','candidate',100),
   ('e','historical:6:DEPUTADO','ac','00200','0002',null,'zone','N','a','10','candidate',80),
   ('other','historical:6:DEPUTADO','ac','00100','0001',null,'zone','N','a','10','candidate',9999);
   insert into election_candidates values ('e','a','ac','Alice','Alice','PSD');`)
  const query=async fn=>{const {sql,params}=fn;return(await db.query(sql,params)).rows}
  let [r]=await query(adapter.totalsSql('historic',6,{state:'ac'}))
  assert.equal(Number(r.valid),180,'state totals win over partial zone rollup')
  assert.equal(Number(r.present),100);assert.equal(Number(r.ballots),200,'Senate-like ballot counts need not equal attendance')
  const [candidate]=await query(adapter.candidatesSql('historic',6,{state:'ac'}))
  assert.equal(Number(candidate.votes),180,'finer candidate units aggregate without repeating population or crossing pleitos')
  const units=await query(adapter.unitsSql('historic',6,'municipality',{state:'ac'}))
  assert.equal(units.length,2);assert.ok(units.every(u=>u.eligible===null),'state population is never copied to each city')
  ;[r]=await query(adapter.totalsSql('historic',6,{state:'rb'}));assert.equal(r.blank,null);assert.equal(r.present,null)
  const empty=await query(adapter.candidatesSql('historic',6,{state:'ac',city_code:'99999'}));assert.equal(empty.length,0)
  await db.exec("insert into election_units select election_id,office_key,'br',null,null,null,'national',null,nominal,legend,sections,valid,blank,null_votes,ballots,eligible,installed,present,absent,not_installed,source_url,source_sha256 from election_units where state='ac' and grain='state'")
  ;[r]=await query(adapter.totalsSql('historic',6,{}));assert.equal(Number(r.eligible),120,'national reference excludes every state/territory descendant')
  ;[r]=await query(adapter.totalsSql('historic',6,{state:'ac'}));assert.equal(Number(r.eligible),120,'state query excludes the national ancestor outside its context')
 }finally{await db.close()}
})

 test('modern gubernatorial candidates keep state identity when ballot numbers repeat',async()=>{
 const db=new PGlite()
 try{
 await db.exec(`create table res(election int,turn int,state text,city text,office int,cand text,votes bigint);
 create table cands(election int,turn int,office int,n text,uf text,name text,short_name text,party text);
 insert into res values(2026,2,'ac','a',3,'13',10),(2026,2,'ac','b',3,'13',20),(2026,2,'am','c',3,'13',40);
 insert into cands values(2026,2,3,'13','ac','A','A','P'),(2026,2,3,'13','am','B','B','P');`)
 let q=adapter.candidatesSql('modern','governor');const candidates=(await db.query(q.sql,q.params)).rows
 assert.equal(candidates.length,2);assert.deepEqual(candidates.map(r=>r.cand),['am/13','ac/13']);assert.deepEqual(candidates.map(r=>Number(r.votes)),[40,30])
 q=adapter.unitsSql('modern','governor','state');const units=(await db.query(q.sql,q.params)).rows
 assert.equal(units.length,2);assert.equal(units.find(r=>r.state==='ac').cand,'ac/13');assert.equal(Number(units.find(r=>r.state==='ac').votes),30)
 }finally{await db.close()}
 })
