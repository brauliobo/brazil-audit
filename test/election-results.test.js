import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'

const source=(await readFile(new URL('../src/election-results.js',import.meta.url),'utf8')).replace(/^import .*\n/gm,'')
const cfg={historic:{sourceSession:{key:'historic',eventIds:['e'],sourceYears:[1933]},officeDefinitions:[{id:'6',key:'historical:6:DEPUTADO'}],offices:[6]}}
const adapter=await import(`data:text/javascript;base64,${Buffer.from(`const ELECTIONS=${JSON.stringify(cfg)};\n${source}`).toString('base64')}`)

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
 }finally{await db.close()}
})
