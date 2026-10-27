// Source identity regressions through the normal application, including a source without a round or date.
import assert from 'node:assert/strict'
import { browser, baseUrl, sleep } from './lib/browser.mjs'
const { ab,evaluate } = browser('election-interface-qa')
const result = `JSON.stringify({text:document.querySelector('main')?.innerText ?? '',year:document.querySelector('.picker select')?.value,yearCount:document.querySelector('.picker select')?.options.length,errors:[...document.querySelectorAll('.notice--danger')].map(e=>e.innerText),loading:!!document.querySelector('.skeleton')||[...document.querySelectorAll('.panel__badge')].some(e=>e.innerText==='…'),width:document.documentElement.scrollWidth,viewport:innerWidth,sqls:document.querySelectorAll('.panel__sql pre').length,resources:performance.getEntriesByType('resource').filter(r=>r.name.includes('/election-units/')||r.name.includes('/facts/')).length,elapsed:performance.now()})`
async function ready(){
  for(let i=0;i<300;i++){
    const r=evaluate(result)
    assert.deepEqual(r.errors,[])
    if(r.text && !r.loading)return r
    await sleep(100)
  }
  throw new Error('Election interface did not become ready')
}
const checks=[]
try {
  for(const width of [320,1280]) {
    ab('set','viewport',String(width),'900')
    for(const page of ['overview','maps','drill/ac','sql']) {
      ab('open',`${baseUrl()}/1933/${page}`)
      const r=await ready()
      assert.equal(r.year,'1933','selected year must match route after options mount')
      assert.ok(r.yearCount>=47)
      assert.ok(r.width<=r.viewport,`${page} overflows at ${width}`)
      if(page==='overview') {
        assert.match(r.text,/DEPUTADO/)
        assert.match(r.text,/1\.466\.700|1,466,700/)
        assert.ok(r.sqls>=2)
        assert.match(r.text,/608/)
      }
      if(page==='drill/ac')assert.match(r.text,/DEPUTADO/)
      checks.push({width,page,year:r.year,sqls:r.sqls,readyMs:Math.round(r.elapsed),requests:r.resources})
    }
  }
  console.log(JSON.stringify(checks))
} finally { ab('close') }
