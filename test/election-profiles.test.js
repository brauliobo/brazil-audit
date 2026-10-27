import test from 'node:test'
import assert from 'node:assert/strict'
import {PGlite} from '@electric-sql/pglite'
import {profileBreakdownQuery,profileOptionsQuery} from '../src/election-profiles.js'

test('profile cells use one snapshot/round/level and preserve unknown counts',async()=>{
 const db=new PGlite()
 try{
  await db.exec(`create table election_profiles(dataset_id text,year int,turn int,level text,state text,city_code text,zone text,gender_code text,gender text,age_code text,age text,present bigint,eligible bigint,source_url text,source_sha256 text);
  insert into election_profiles values
  ('a',2012,1,'state','ac',null,null,'2','Feminino','1','18–24',40,50,'source','hash'),
  ('a',2012,1,'state','ac',null,null,'2','Feminino','2','25–34',null,30,'source','hash'),
  ('a',2012,1,'state','ac',null,null,'4','Masculino','1','18–24',30,40,'source','hash'),
  ('a',2012,2,'state','ac',null,null,'2','Feminino','1','18–24',999,999,'source','hash'),
  ('a',2012,1,'detail','ac','00100','0001','2','Feminino','1','18–24',40,50,'source','hash'),
  ('other',2012,1,'state','ac',null,null,'2','Feminino','1','18–24',999,999,'source','hash');`)
  const scope={dataset_id:'a',year:2012,turn:1,level:'state',state:'ac'}
  let q=profileBreakdownQuery(scope,'gender','present');let rows=(await db.query(q.sql,q.params)).rows
  assert.equal(rows.length,2);assert.equal(rows[0].value,null);assert.equal(Number(rows[0].known_value),40);assert.equal(Number(rows[0].known_cells),1);assert.equal(Number(rows[0].cells),2)
  q=profileBreakdownQuery({...scope,filters:{age:'1'}},'gender','present');rows=(await db.query(q.sql,q.params)).rows
  assert.deepEqual(rows.map(r=>Number(r.value)),[40,30])
  assert.throws(()=>profileOptionsQuery(scope,'gender; drop table election_profiles'))
 }finally{await db.close()}
})
