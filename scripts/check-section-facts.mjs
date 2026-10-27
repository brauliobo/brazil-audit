// Real 1998 AC source regression, including the older BR file's observed Rio Branco coverage.
import assert from 'node:assert/strict'
import { readFileSync,readdirSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { parseCsvLine } from './csv.mjs'
import { PGlite } from '@electric-sql/pglite'
const input=process.argv.find((a)=>a.startsWith('--input='))?.slice(8)
assert.ok(input,'--input=<normalized 1998 AC pilot> is required')
const sources=readdirSync(join(input,'sources')).filter((f)=>f.endsWith('.json')).map((f)=>JSON.parse(readFileSync(join(input,'sources',f))))
assert.equal(sources.length,3)
const db=new PGlite()
try {
  const created=new Set()
  for(const source of sources){
    assert.equal(source.status,'ready')
    const t=source.table
    if(!created.has(t.name)){await db.exec(t.ddl);created.add(t.name)}
    for(const part of Object.values(t.parts)){
      const packed=readFileSync(join(input,part.url))
      assert.equal(createHash('sha256').update(packed).digest('hex'),part.sha256)
      assert.equal(packed.length,part.bytes)
      const raw=gunzipSync(packed)
      assert.equal(raw.length,part.rawBytes)
      await db.query(`copy ${t.name} (${t.columns}) from '/dev/blob' csv`,[],{blob:new Blob([raw])})
    }
  }
  const query=async(sql)=>(await db.query(sql)).rows
  for(const table of created){
    const extras=table.endsWith('votes')?',kind,number':''
    const [r]=await query(`select count(*) n from (select election_id,state,city_code,zone,section,office,transit${extras},count(*) n from ${table} group by election_id,state,city_code,zone,section,office,transit${extras} having count(*)>1) d`)
    assert.equal(Number(r.n),0,`${table} has duplicate source observations`)
  }
  const coverage=await query(`select office,count(distinct(state,city_code,zone,section)) sections,count(distinct city_code) municipalities,
    sum(votes) filter(where kind='candidate') nominal,sum(votes) filter(where kind='blank') blank,
    sum(votes) filter(where kind='null_native') nul,sum(votes) total from election_section_votes group by office order by office`)
  const pres=coverage.find((r)=>r.office==='1')
  assert.equal(Number(pres.sections),367)
  assert.equal(Number(pres.municipalities),1)
  assert.equal(Number(pres.nominal),104297)
  assert.equal(Number(pres.blank),2644)
  assert.equal(Number(pres.nul),11799)
  assert.equal(Number(pres.total),118740)
  const [official]=await query("select count(*) sections,count(distinct city_code) municipalities,sum(nominal_reported) nominal from election_section_units where office='1'")
  assert.equal(Number(official.sections),919)
  assert.equal(Number(official.municipalities),22)
  assert.equal(Number(official.nominal),193081)
  const [mismatch]=await query(`with counts as (select election_id,state,city_code,zone,section,office,
    sum(votes) filter(where kind='candidate') nominal,sum(votes) filter(where kind='party_list') legend,
    sum(votes) filter(where kind='blank') blank,sum(votes) filter(where kind='null_native') nul
    from election_section_votes group by election_id,state,city_code,zone,section,office)
    select count(*) n from counts c join election_section_units u using(election_id,state,city_code,zone,section,office)
    where c.nominal is distinct from u.nominal_reported or coalesce(c.legend,0) is distinct from u.legend_reported
    or c.blank is distinct from u.blank or c.nul is distinct from u.null_votes`)
  assert.equal(Number(mismatch.n),0,'section counts must match independent detail sources wherever both provide that section')
  let reloadTest='not-packed'
  for(const source of sources.filter((s)=>s.table.name==='election_section_votes')) {
    const parts=Object.values(source.table.parts)
    const a=parts.find((p)=>p.sourcePart && parts.some((q)=>q!==p && q.offices[0]===p.offices[0] && q.cities.some((city)=>p.cities.includes(city))))
    if(!a)continue
    const b=parts.find((q)=>q!==a && q.offices[0]===a.offices[0] && q.cities.some((city)=>a.cities.includes(city)))
    const before=(await query(`select source_part,count(*) n,sum(votes) votes from election_section_votes group by source_part`))
    const beforeA=before.find((r)=>r.source_part===a.sourcePart),beforeB=before.find((r)=>r.source_part===b.sourcePart)
    const text=gunzipSync(readFileSync(join(input,a.url))).toString()
    const lines=text.trimEnd().split('\n'),fields=source.table.columns.split(',')
    const first=parseCsvLine(lines[0]);first[fields.indexOf('votes')]=String(Number(first[fields.indexOf('votes')])+1)
    lines[0]=first.map((v)=>v===''?'':'"'+v.replaceAll('"','""')+'"').join(',')
    const replacement=Buffer.from(lines.join('\n')+'\n')
    assert.notEqual(createHash('sha256').update(replacement).digest('hex'),createHash('sha256').update(gunzipSync(readFileSync(join(input,a.url)))).digest('hex'))
    await db.exec(`delete from election_section_votes where ${a.where}`)
    await db.query(`copy election_section_votes (${source.table.columns}) from '/dev/blob' csv`,[],{blob:new Blob([replacement])})
    const after=await query(`select source_part,count(*) n,sum(votes) votes from election_section_votes group by source_part`)
    const afterA=after.find((r)=>r.source_part===a.sourcePart),afterB=after.find((r)=>r.source_part===b.sourcePart)
    assert.deepEqual(afterB,beforeB,'reloading a changed part must preserve the other chunk of the same municipality')
    assert.equal(Number(afterA.n),Number(beforeA.n))
    assert.equal(Number(afterA.votes),Number(beforeA.votes)+1)
    reloadTest='changed-hash-same-city-isolated';break
  }
  if(sources.some((s)=>Object.values(s.table.parts).some((p)=>p.sourcePart)))assert.equal(reloadTest,'changed-hash-same-city-isolated')
  console.log(JSON.stringify({sources:sources.map((s)=>({url:s.source.source_url,sha256:s.source.source_sha256,rows:s.rows})),coverage,official,mismatch:Number(mismatch.n),reloadTest}))
}finally{await db.close()}
