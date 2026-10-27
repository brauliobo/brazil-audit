import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {gunzipSync} from 'node:zlib'
import {createHash} from 'node:crypto'
import {PGlite} from '@electric-sql/pglite'
import {NOMINATION_TABLES} from '../src/nomination-contract.js'
const source=(await readFile(new URL('../src/election-nominations.js',import.meta.url),'utf8')).replace(/^import .*\n/gm,'').replace(/^export \{.*\n/gm,'')
const api=await import(`data:text/javascript;base64,${Buffer.from(`const NOMINATION_TABLES=${JSON.stringify(NOMINATION_TABLES)};\n${source}`).toString('base64')}`)
const scope={key:'1933',sourceYears:[1933],eventIds:['1933:legacy-1933-f8f41fe279:na'],officeKey:'historical:6:DEPUTADO',turn:null,state:'sp'}

test('real 1933 source declarations and nomination-list records remain available without inventing an election link',async()=>{
 const db=new PGlite()
 try{
  const meta=JSON.parse(await readFile(new URL('./archive/fixtures/nominations-1933-sp.json',import.meta.url),'utf8'))
  for(const [name,definition] of Object.entries(meta)){
   await db.exec(definition.ddl)
   const body=await readFile(new URL('./archive/fixtures/'+definition.file,import.meta.url))
   assert.equal(createHash('sha256').update(body).digest('hex'),definition.sha256)
   await db.exec(`copy ${name} (${definition.columns}) from '/dev/blob' csv`,{blob:new Blob([gunzipSync(body)])})
   const q=api.nominationFactsQuery(name,scope,{limit:null}),rows=(await db.query(q.sql,q.params)).rows
   assert.equal(rows.length,definition.rows)
   assert.ok(rows.every(r=>r.election_id===null&&r.binding_kind==='source-context'&&r.office_key==='historical:6:DEPUTADO'))
   if(name==='election_lists')assert.ok(rows.some(r=>[r.party_name,r.coalition_name,r.composition].filter(Boolean).join(' ').toUpperCase().includes('CHAPA')))
   if(name==='candidate_list_links')assert.ok(rows.every(r=>r.candidate_id===null),'unproven person links are not made from names')
  }
  let page=api.nominationFactsQuery('candidate_list_links',scope),first=(await db.query(page.sql,page.params)).rows
  assert.equal(first.length,100);assert.equal(Number(first[0].total_rows),152)
  page=api.nominationFactsQuery('candidate_list_links',scope,{offset:100});const second=(await db.query(page.sql,page.params)).rows
  assert.equal(second.length,52);assert.equal(new Set([...first,...second].map(r=>r.source_record_id)).size,152)
  const provenance=api.nominationProvenanceQuery('candidate_list_links',scope);assert.ok((await db.query(provenance.sql,provenance.params)).rows.length>0)
  const wrong=api.nominationFactsQuery('candidate_list_links',{...scope,key:'unrelated-same-year'});assert.equal((await db.query(wrong.sql,wrong.params)).rows.length,0)
  await db.exec("update election_declared_seats set seats=0")
  const q=api.nominationFactsQuery('election_declared_seats',scope);assert.equal(Number((await db.query(q.sql,q.params)).rows[0].seats),0,'explicit zero seats stays zero')
  await db.exec("update election_declared_seats set election_id='other-exact-election'")
  assert.equal((await db.query(q.sql,q.params)).rows.length,0,'an explicitly different election is not linked by source year')
 }finally{await db.close()}
})

test('an explicit modern office-code bridge keeps the raw label and requires the source event code and date',async()=>{
 const db=new PGlite()
 try{
  const meta=JSON.parse(await readFile(new URL('./archive/fixtures/nominations-1994-sp-seats.json',import.meta.url),'utf8'))
  await db.exec(meta.ddl)
  const body=await readFile(new URL('./archive/fixtures/'+meta.file,import.meta.url));assert.equal(createHash('sha256').update(body).digest('hex'),meta.sha256)
  await db.exec(`copy election_declared_seats (${meta.columns}) from '/dev/blob' csv`,{blob:new Blob([gunzipSync(body)])})
  const selection={key:'1994',sourceYears:[1994],eventIds:['1994:1994001:1:1994-10-03'],officeKey:'historical:9:1º SUPLENTE SENADOR',turn:1,state:'sp',
    officeBindings:[{sourceYear:1994,office:'9',rawOfficeKey:'historical:9:1. SUPLENTE SENADOR',officeKey:'historical:9:1º SUPLENTE SENADOR',tables:['election_declared_seats'],events:[{code:'1994001',date:'1994-10-03',sessionKey:'1994'}]}]}
  const query=api.nominationFactsQuery('election_declared_seats',selection)
  const rows=(await db.query(query.sql,query.params)).rows
  assert.equal(rows.length,1);assert.equal(Number(rows[0].seats),2);assert.equal(rows[0].office_key,'historical:9:1. SUPLENTE SENADOR');assert.equal(rows[0].binding_kind,'source-context')
  await db.exec("update election_declared_seats set election_date='1994-10-04' where office='9'")
  assert.equal((await db.query(query.sql,query.params)).rows.length,0,'a different event date does not inherit the bridge')
 }finally{await db.close()}
})
