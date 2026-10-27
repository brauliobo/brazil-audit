import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { installElectionRegistry,ELECTIONS,selectedOffice } from '../src/election-registry.js'
const registry=JSON.parse(readFileSync('data/elections.json','utf8'))
installElectionRegistry(registry)
const keys=['1933','2026-2','e-2024-6295-1-2026-12-06']
const source=readFileSync('src/sqlExamples.js','utf8').replace(/^import .*\n/gm,'')
const module=await import(`data:text/javascript;base64,${Buffer.from(`const ref=value=>({value});const ELECTIONS=${JSON.stringify(Object.fromEntries(keys.map(k=>[k,ELECTIONS[k]])))};const selectedOffice=${selectedOffice.toString()};\n${source}`).toString('base64')}`)
test('default SQL follows the actual office and complete source election identity',()=>{
 const sql=module.initialSql('1933',null,'historical:6:DEPUTADO')
 assert.match(sql,/office_key = 'historical:6:DEPUTADO'/)
 assert.doesNotMatch(sql,/rdv|office = 1|NaN/)
 const governor=module.fill(module.EXAMPLES.find(e=>e.id==='electionCandidates').sql,'2026-2','governor')
 assert.match(governor,/office_key = 'governor'/)
 assert.match(governor,/2026:6260:2:2026-10-25/)
})
test('a registration-only election starts from the roster, without requiring a turnout row',()=>{
 const key='e-2024-6295-1-2026-12-06'
 const sql=module.initialSql(key,null,'mayor')
 assert.match(sql,/from candidate_attributes/)
 assert.match(sql,/2024:6295:1:2026-12-06/)
 assert.doesNotMatch(sql,/from election_units|coalesce|sum\(/)
 assert.equal(module.examplesFor(key,'mayor').some(e=>e.id==='electionUnits'),false)
})
