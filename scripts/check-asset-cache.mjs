// Regression check against Vite dev: node scripts/check-asset-cache.mjs http://127.0.0.1:4196/brazil-audit
// A browser HTTP cache keys responses by URL. A new artifact version must reach that URL, then Cache API serves repeat reads.
import assert from 'node:assert/strict'
import { browser,baseUrl } from './lib/browser.mjs'
const {ab,evaluate}=browser('asset-cache-regression')
try {
  ab('open',baseUrl()+'/2026-2/compare')
  const result=evaluate(`(async()=>{
    const {cachedFetch,ASSET_CACHE}=await import('${baseUrl()}/src/db/fetching.js')
    const data=await import('${baseUrl()}/src/data.js')
    await data.ready
    const {many}=await import('${baseUrl()}/src/db/index.js')
    const [{v:databaseVersion}]=await many("select v from _meta where k='version'")
    const original=window.fetch
    const url=location.origin+'${new URL(baseUrl()).pathname}/asset-probe-'+crypto.randomUUID()+'.csv'
    const cache=await caches.open(ASSET_CACHE)
    const legacy=await caches.open('auditoria-assets-v1')
    await legacy.put(url+'?v=release-new',new Response('stale',{status:200}))
    const requests=[]
    try {
      window.fetch=async(input,options)=>{const address=String(input);if(!address.startsWith(url))return original(input,options);requests.push(address);return new Response(address.endsWith('?v=release-new')?'new':'stale',{status:200})}
      const first=await(await cachedFetch(url,'release-old')).text()
      const second=await(await cachedFetch(url,'release-new')).text()
      for(let i=0;i<50&&!await cache.match(url+'?v=release-new');i++) await new Promise(r=>setTimeout(r,10))
      const repeated=await(await cachedFetch(url,'release-new')).text()
      return JSON.stringify({first,second,repeated,requests,databaseVersion,expectedDatabaseVersion:data.store.manifest.version+':'+ASSET_CACHE})
    } finally {
      window.fetch=original
      await cache.delete(url+'?v=release-old');await cache.delete(url+'?v=release-new');await legacy.delete(url+'?v=release-new')
    }
  })()`)
  assert.equal(result.databaseVersion,result.expectedDatabaseVersion,'persisted imports are invalidated when the asset policy changes')
  assert.equal(result.first,'stale')
  assert.equal(result.second,'new','new content version must bypass a response cached at the original URL')
  assert.equal(result.repeated,'new')
  assert.equal(result.requests.length,2,'repeat version comes from Cache API')
  console.log('asset cache: new versions bypass HTTP cache; repeated reads use Cache API')
} finally {ab('close')}
