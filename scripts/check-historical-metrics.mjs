// Regressions against shipped official source records: native vote totals, unknown totals and separate legal statuses.
import {readFileSync,createReadStream} from 'node:fs'
import {createGunzip} from 'node:zlib'
import {createInterface} from 'node:readline'
import assert from 'node:assert/strict'
import {parseHistoricalCsv,historicalValue} from '../src/history-comparison.js'
const index=JSON.parse(readFileSync('data/history/indicators.json'))
async function find(year,office,test){
  for(const e of index.elections.filter(e=>e.year===year&&e.turn===1&&e.offices.some(o=>o.key===office))){
    for(const part of e.parts){
      const lines=createInterface({input:createReadStream('data/'+part.url).pipe(createGunzip()),crlfDelay:Infinity})
      let header
      for await(const line of lines){
        if(!header){header=line;continue}
        const row=parseHistoricalCsv(header+'\n'+line+'\n')[0]
        if(row.office_key===office&&test(row)){lines.close();return row}
      }
    }
  }
  throw new Error(`Official fixture missing: ${year}/${office}`)
}
const senate=await find(2018,'senator',r=>r.state==='ac'&&r.city_code==='01112'&&r.zone==='0006'&&r.present===9243)
assert.equal(senate.ballots,18486)
assert.equal(historicalValue([senate],'blank_rate','senator').denominator,18486)
const invalid=await find(1994,'governor',r=>r.ballots===null&&r.ballots_reported===0&&r.blank>0)
const missing=historicalValue([invalid],'blank_rate','governor')
assert.equal(missing.value,null)
assert.equal(missing.reason,'incompatible_ballot_total')
const df=await find(2026,'governor',r=>r.state==='df'&&r.scope==='state')
assert.equal(df.ballots,1817921)
assert.equal(df.valid,1651394)
assert.equal(historicalValue([df],'blank_rate','governor').denominator,1817921)
console.log(JSON.stringify({senate:{present:senate.present,ballots:senate.ballots},incompatible:{state:invalid.state,reported:invalid.ballots_reported,reason:missing.reason},df:{ballots:df.ballots,valid:df.valid,blank:df.blank,null:df.null,technical:df.null_technical,subjudice:df.annulled_subjudice}}))
