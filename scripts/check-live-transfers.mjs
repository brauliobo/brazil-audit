// Runs against a Pages-like local build; reports cold browser readiness and warm SQL/filter times.
import assert from 'node:assert/strict'
import {browser,baseUrl,sleep} from './lib/browser.mjs'
const {ab,evaluate}=browser('uf-live-qa-lazy')
const resultScript=`JSON.stringify({ready:!!document.querySelector('main .panel>.body>.table-wrap')&&!document.querySelector('.skeleton')&&![...document.querySelectorAll('.panel__badge')].some(e=>e.innerText==='…'),elapsed:performance.now(),errors:[...document.querySelectorAll('.notice--danger')].map(e=>e.innerText),badges:[...document.querySelectorAll('.panel__badge')].map(e=>e.innerText),sqls:document.querySelectorAll('.panel__sql pre').length,links:[...document.querySelectorAll('.panel__sql a')].map(e=>e.getAttribute('href')),rounds:[...document.querySelectorAll('main .panel>.body>details[open] tbody tr')].map(r=>[...r.cells].map(c=>c.innerText)),resources:performance.getEntriesByType('resource').filter(r=>r.name.includes('/state-facts/')).length})`
async function waitReady(expected){
  for(let i=0;i<400;i++){
    const r=evaluate(resultScript)
    assert.deepEqual(r.errors,[])
    if(r.ready&&expected(r))return r
    await sleep(150)
  }
  throw new Error('Live transfer data did not become ready')
}
try{
  const cases=[{name:'presidential AC',year:2026,office:1,state:'ac',rounds:2},{name:'presidential Brazil',year:2026,office:1,state:'br',rounds:56},{name:'governor AC',year:2026,office:3,state:'ac',rounds:2},{name:'governor RO 2018',year:2018,office:3,state:'ro',rounds:2}]
  const results=[]
  for(const [i,c]of cases.entries()){
    const url=`${baseUrl()}/2026-2/compare?comparison_mode=flows&flow_year=${c.year}&flow_office=${c.office}&flow_state=${c.state}`
    const start=performance.now();ab('open',url)
    const r=await waitReady(r=>r.rounds.length===c.rounds&&r.rounds.every(row=>row[2].startsWith(String(c.year))))
    assert.equal(r.sqls,4,'all calculations are inspectable SQL')
    assert.ok(r.links.every(link=>link.startsWith('/brazil-audit/2026-2/sql?')),'SQL links preserve a valid election route')
    if(c.name==='governor AC')assert.ok(r.rounds.some(row=>row[3].replace(/\D/g,'')==='613336'),'governor population is distinct from presidential population')
    results.push({case:c.name,wallMs:Math.round(performance.now()-start),browserReadyMs:Math.round(r.elapsed),sql:r.badges,sourceRequests:r.resources})
  }
  console.log(JSON.stringify(results))
}finally{ab('close')}
