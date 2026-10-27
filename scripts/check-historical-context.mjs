// Deep links must keep the displayed office, territory and inspected SQL in agreement.
import assert from 'node:assert/strict'
import {browser,baseUrl,sleep} from './lib/browser.mjs'
const {ab,evaluate}=browser('historical-context-qa')
const inspect=`JSON.stringify({text:document.querySelector('main')?.innerText ?? '',selects:[...document.querySelectorAll('main select')].map(s=>({value:s.value,label:s.selectedOptions[0]?.textContent})),errors:[...document.querySelectorAll('.notice--danger')].map(e=>e.innerText),loading:!!document.querySelector('.skeleton')||[...document.querySelectorAll('.panel__badge')].some(e=>e.innerText==='…'),sql:[...document.querySelectorAll('.panel__sql pre')].map(e=>e.textContent),overflow:document.documentElement.scrollWidth>innerWidth,elapsed:performance.now()})`
async function ready(){
 for(let i=0;i<450;i++){
  const r=evaluate(inspect);assert.deepEqual(r.errors,[])
  if(r.text && !r.loading && r.sql.length)return r
  await sleep(100)
 }
 throw Error('Historical context did not become ready')
}
const cases=[
 {path:'1933/overview?state=sp',office:'historical:6:DEPUTADO',state:'sp',year:'1933',match:/PLINIO|PLÍNIO/},
 {path:'2014/overview?office=senator&state=ac',office:'senator',state:'ac',year:'2014',match:/374\.813|374,813/},
 {path:'2026-2/overview?office=governor&state=ac',office:'governor',state:'ac',year:'2026',match:/Governador/},
 {path:'2000/maps?office=mayor&state=ac',office:'mayor',state:'ac',year:'2000',match:/RIO BRANCO/i},
 {path:'e-2024-6295-1-2026-12-06/overview?office=mayor',office:'mayor',state:'ma',year:'2026',match:/CLELIA MARIA BARROS DOS SANTOS/},
]
const output=[]
try{
 for(const width of [320,1280]){
  ab('set','viewport',String(width),'900')
  for(const c of cases){
   ab('open',`${baseUrl()}/${c.path}`)
   const r=await ready()
   assert.equal(r.selects[0]?.value,c.office)
   assert.equal(r.selects[1]?.value,c.state)
   assert.match(r.text,c.match)
   assert.equal(r.overflow,false,`${c.path} overflow at ${width}`)
   assert.ok(r.sql.some(sql=>sql.includes(`office_key = '${c.office}'`)))
   assert.ok(r.sql.some(sql=>sql.includes('any(array[')),'inspectable source IDs must be a valid SQL array')
   if(c.path.startsWith('1933')){assert.doesNotMatch(r.text,/Perfil do eleitorado e da participação/);assert.match(r.text,/CHAPA ÚNICA POR SÃO PAULO UNIDO/)}
   if(c.path.startsWith('e-2024')){
    assert.match(r.text,/2 candidaturas/)
    assert.doesNotMatch(r.text,/0 unidades|0 votos/)
   }
   output.push({width,path:c.path,readyMs:Math.round(r.elapsed),queries:r.sql.length})
  }
 }
 console.log(JSON.stringify(output))
}finally{ab('close')}
