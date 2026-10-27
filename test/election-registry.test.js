import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ELECTION_LIST as COLLECTORS } from '../src/elections.js'
import { ELECTION_LIST, ELECTIONS, installElectionRegistry, selectedOffice, supportsView, currentStateGeometry, territorialGrain, contextParams } from '../src/election-registry.js'
import { parseRoute } from '../src/routes.js'
const registry = JSON.parse(readFileSync('data/elections.json','utf8'))
installElectionRegistry(registry)

test('all source sessions are normal routes and every real year is selectable', () => {
  assert.equal(ELECTION_LIST.length,registry.sessions.length)
  assert.deepEqual([...new Set(ELECTION_LIST.map((e)=>e.year))],[...new Set(registry.sessions.map((e)=>e.year))])
  for(const e of ELECTION_LIST) {
    const r = parseRoute('/',`/${encodeURIComponent(e.key)}/overview`,'?state=ac')
    assert.equal(r.election,e.key)
    assert.equal(r.notFound,false)
    assert.equal(r.params.get('state'),'ac')
  }
})
test('1933 preserves its constituent office, unknown turn/date and real aggregate grain', () => {
  const e=ELECTIONS['1933']
  assert.equal(e.turn,null)
  assert.equal(e.date,null)
  assert.equal(selectedOffice('1933','1').key,'historical:6:DEPUTADO')
  assert.deepEqual(selectedOffice('1933').capabilities.grains,['state'])
  assert.equal(supportsView('1933','analysis'),true)
  assert.equal(supportsView('1933','time'),false)
  assert.equal(supportsView('1933','seats'),false)
})
test('legacy URLs remain collector aliases without changing build inputs', () => {
  assert.equal(COLLECTORS.length,6)
  for(const old of COLLECTORS) {
    assert.equal(ELECTIONS[old.key].legacyKey,old.key)
    assert.equal(parseRoute('/',`/${old.key}/maps`,'').election,old.key)
  }
  assert.equal(parseRoute('/','/overview','').election,'2026-2')
})
test('municipal and supplementary identities remain separate, using actual source dates', () => {
  assert.equal(selectedOffice('2000').key,'mayor')
  const seen=new Set()
  for(const e of ELECTION_LIST) {
    for(const id of e.sourceSession.eventIds) { assert.equal(seen.has(id),false,id);seen.add(id) }
  }
  assert.equal(seen.size,registry.events.length)
  const delayed=ELECTION_LIST.find((e)=>e.sourceSession.eventIds.includes('2022:6278:1:2026-06-21'))
  assert.ok(delayed)
  assert.equal(delayed.year,2026)
  assert.ok(delayed.sourceSession.sourceYears.includes(2022))
})

test('state maps use geographic compatibility rather than collector availability', () => {
  assert.equal(currentStateGeometry('2000',['ac','sp'],['ac','sp']).available,true)
  assert.equal(currentStateGeometry('1998',['ac','sp'],['ac','sp']).available,true)
  assert.equal(currentStateGeometry('1933',['go','df'],['go','df']).available,false)
  assert.equal(currentStateGeometry('2000',['gb'],['ac','sp']).available,false)
  const mixed = currentStateGeometry('2000',['ac','vt'],['ac','sp'])
  assert.equal(mixed.available,true)
  assert.deepEqual(mixed.mappedCodes,['ac'])
  assert.deepEqual(mixed.unmappedCodes,['vt'])
})

test('local offices keep municipal constituencies and context does not carry unsupported UFs', () => {
  assert.equal(territorialGrain(selectedOffice('2000','mayor')),'municipality')
  assert.equal(territorialGrain(selectedOffice('2024','councillor')),'municipality')
  const fn=ELECTION_LIST.find(e=>e.officeDefinitions.some(o=>String(o.id)==='25'))
  assert.ok(fn)
  assert.equal(territorialGrain(fn.officeDefinitions.find(o=>String(o.id)==='25')),'municipality')
  assert.equal(territorialGrain(selectedOffice('1933')),'state')
  const normalized=contextParams('2026-2',{office:'governor',state:'sp',city:'71072',cand:'13'})
  assert.equal(normalized.state,undefined)
  assert.equal(normalized.city,undefined)
  const switched=contextParams('1933',{office:'governor',state:'ac',city:'01120',cand:'13'},true)
  assert.equal(switched.office,'historical:6:DEPUTADO')
  assert.equal(switched.city,undefined)
  assert.equal(switched.cand,undefined)
})
