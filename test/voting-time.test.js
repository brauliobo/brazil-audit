import assert from 'node:assert/strict'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { vtSql } from '../scripts/voting-time.mjs'

test('voting-time queries exclude earlier election days in reused machine logs', async () => {
  const db = new PGlite()
  try {
    await db.exec(`create table rdv_votes (state text, city text, zone text, section text, model text, office int);
      create table rdv_machine (state text, city text, city_code text, zone text, section text, model text, office int, turn int);
      create table voting_times (state text, city text, city_code text, zone text, section text, model text, post text, time timestamp, turn int);
      insert into rdv_votes values ('ac','CITY','0001','0001','UE2020',1);
      insert into rdv_machine values ('ac','CITY','01007','0001','0001','UE2020',1,2);`)
    for (const [kind, year, date, old] of [['rdv',2026,'2026-10-25','2026-10-04'],['machine',2022,'2022-10-30','2022-10-02']]) {
      await db.exec(`truncate voting_times;
        insert into voting_times values
        ('ac','CITY','01007','0001','0001','UE2020','Presidente','${old} 06:00:00',2),
        ('ac','CITY','01007','0001','0001','UE2020','Presidente','${date} 08:00:00',2),
        ('ac','CITY','01007','0001','0001','UE2020','Presidente','${date} 08:01:00',2),
        ('ac','CITY','01007','0001','0001','UE2020','Presidente','${date}'::timestamp + interval '1 day',2);`)
      const { rows: [r] } = await db.query(vtSql({ year, turn: 2, date, source: { kind } }, 'ac', 'CITY'))
      assert.equal(Number(r.count), 2, `${kind}: only the selected day's votes`)
      assert.equal(r.min, 8 * 3600)
      assert.equal(r.max, 60, `${kind}: gaps are computed within the selected day`)
    }
  } finally {
    await db.close()
  }
})
