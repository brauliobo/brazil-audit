import assert from 'node:assert/strict'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { vtSql, votingTimeRollups } from '../scripts/voting-time.mjs'

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
      const { rows: [r] } = await db.query(`select * from (${vtSql({ year, turn: 2, date, source: { kind } }, 'ac', 'CITY')}) vt(election,turn,state,city,zone,section,model,n,first,last,med,p10,p90,maxgap,b)`)
      assert.equal(Number(r.n), 2, `${kind}: only the selected day's votes`)
      assert.equal(r.first, 8 * 3600)
      assert.equal(r.maxgap, 60, `${kind}: gaps are computed within the selected day`)
      const csv = [...Object.values(r).slice(0, -1), `"${r.b}"`].join(',')
      const rollups = votingTimeRollups('ac', [csv, csv])
      assert.equal(rollups.length, 1)
      assert.deepEqual(rollups[0].slice(0, 4), ['ac', 'CITY', 2, 4])
      const buckets = rollups[0][5].slice(1, -1).split(',').map(Number)
      assert.equal(buckets.length, 90)
      assert.equal(buckets.reduce((a, b) => a + b, 0), 4, `${kind}: national/state/city totals keep only polling-day events`)
    }
  } finally {
    await db.close()
  }
})
