import test from 'node:test'
import assert from 'node:assert/strict'
import {PGlite} from '@electric-sql/pglite'
import {inline} from '../src/db/sql.js'
test('inspection SQL reproduces bound election arrays, quotes, NULLs and numeric values',async()=>{
 const db=new PGlite()
 try{
  const sql='select $1::text[] ids,$2::text label,$3::bigint missing,$4::float8 value'
  const params=[['1933:source','2026:6260:2:2026-10-25'],"D'Ávila",null,2.5]
  assert.deepEqual((await db.query(inline(sql,params))).rows,(await db.query(sql,params)).rows)
  assert.deepEqual((await db.query(inline('select $1::text[] empty',[[]]))).rows,[{empty:[]}])
 }finally{await db.close()}
})
