import test from 'node:test'
import assert from 'node:assert/strict'
import {PGlite} from '@electric-sql/pglite'
import {transferBoundsSql,transferUnitsSql,transferObservedSql} from '../src/transfer-sql.js'

test('live bounds preserve contest identities, independent categories, territorial constraints and administrative scenario',async()=>{
  const db=new PGlite()
  try {
    await db.exec(`create table state_rounds(contest_id text,election_id text,year int,date date,office int,state text,city text,turn int,description text,electorate bigint,installed bigint,present bigint,absent bigint,not_installed bigint,turnout_complete boolean,votes_complete boolean,source_url text,source_sha256 text);
      create table state_round_counts(contest_id text,state text,turn int,year int,category_id text,label text,candidate_id text,count bigint,source_url text,source_sha256 text);`)
    async function round(contest,office,state,turn,eligible,present,absent,notInstalled,counts,complete=true,city=null){
      await db.query('insert into state_rounds values($1,$2,2026,DATE \'2026-10-25\',$3,$4,$5,$6,\'source\',$7,$8,$9,$10,$11,true,$12,\'https://example.org/source\',\'hash\')',[contest,`${contest}-${turn}`,office,state,city,turn,eligible,eligible-notInstalled,present,absent,notInstalled,complete])
      for(const [id,n] of Object.entries(counts))await db.query('insert into state_round_counts values($1,$2,$3,2026,$4,$5,$6,$7,\'https://example.org/source\',\'hash\')',[contest,state,turn,id,id,`source-${contest}-${turn}-${id}`,n])
    }
    await round('pres',1,'ac',1,100,80,20,0,{A:60,blank:10,null_native:10})
    await round('pres',1,'ac',2,110,90,20,0,{X:70,blank:5,null_native:15})
    await round('pres',1,'am',1,100,90,10,0,{B:90})
    await round('pres',1,'am',2,90,80,10,0,{X:10,Y:70})
    // Reused numbers/labels in another contest never join the selected contest.
    await round('other',1,'ac',1,1000,1000,0,0,{A:1000})
    await round('other',1,'ac',2,1000,1000,0,0,{X:1000})
    const {rows}=await db.query(transferBoundsSql,['pres','br',1,null])
    const ax=rows.find(r=>r.from_id==='A'&&r.to_id==='X')
    assert.equal(ax.from_total,60);assert.equal(ax.to_total,80)
    assert.equal(ax.bound_low,20,'sum of UF bounds is tighter than pooled national bound (zero)')
    assert.equal(ax.bound_high,60)
    const from=new Set(rows.map(r=>r.from_id)),to=new Set(rows.map(r=>r.to_id))
    assert.equal(rows.length,from.size*to.size,'full product of distinct round categories')
    assert.ok(from.has('A')&&!to.has('A')&&to.has('X')&&!from.has('X'))
    assert.equal(rows.find(r=>r.from_id==='administrative_balance').from_total,10)
    assert.equal(rows.find(r=>r.to_id==='administrative_balance').to_total,10)
    const {rows:units}=await db.query(transferUnitsSql,['pres','br',1,null])
    assert.deepEqual(units.map(r=>Number(r.population)),[110,100])
    assert.equal(units.reduce((n,r)=>n+Number(r.first_electorate),0),200,'technical N is distinct from observed TE')
    await round('gov',3,'ac',1,50,30,18,2,{A:25,annulled:2,annulled_subjudice:3})
    await round('gov',3,'ac',2,50,35,15,0,{X:35})
    await round('gov',3,'am',1,200,200,0,0,{A:200})
    await round('gov',3,'am',2,200,200,0,0,{X:200})
    const {rows:gov}=await db.query(transferBoundsSql,['gov','ac',3,null])
    assert.equal(gov.find(r=>r.from_id==='A').from_total,25)
    assert.equal(gov.find(r=>r.from_id==='not_installed').from_total,2)
    assert.ok(gov.some(r=>r.from_id==='annulled_subjudice'),'source categories remain separate')
    assert.equal((await db.query(transferBoundsSql,['gov','br',3,null])).rows.length,0,'governors are not pooled across UFs')
    await round('incomplete',3,'ac',1,50,30,20,0,{A:20},false)
    await round('incomplete',3,'ac',2,50,35,15,0,{X:35})
    assert.equal((await db.query(transferBoundsSql,['incomplete','ac',3,null])).rows.length,0,'missing categories are not turned into residual votes')
    assert.equal((await db.query(transferUnitsSql,['incomplete','ac',3,null])).rows[0].reason,'invalid_vote_partition')
    assert.ok((await db.query(transferObservedSql,['incomplete','ac',3,null])).rows.some(r=>r.category_id==='A'&&Number(r.n)===20),'observed data remain queryable')
    await round('mayor-one',11,'sp',1,100,80,20,0,{A:80},true,'01007')
    await round('mayor-one',11,'sp',2,100,90,10,0,{X:90},true,'01007')
    await round('mayor-two',11,'sp',1,1000,900,100,0,{A:900},true,'02008')
    await round('mayor-two',11,'sp',2,1000,800,200,0,{X:800},true,'02008')
    const {rows:mayor}=await db.query(transferBoundsSql,['mayor-one','sp',11,'01007'])
    assert.equal(mayor.find(r=>r.from_id==='A').from_total,80,'municipal candidates stay in their own contest')
    assert.equal((await db.query(transferBoundsSql,['mayor-one','sp',11,'02008'])).rows.length,0)
    await round('single',1,'ac',1,50,30,20,0,{A:30})
    assert.equal((await db.query(transferUnitsSql,['single','ac',1,null])).rows[0].reason,'missing_round')
    assert.equal((await db.query(transferBoundsSql,['single','ac',1,null])).rows.length,0)
  } finally {await db.close()}
})
