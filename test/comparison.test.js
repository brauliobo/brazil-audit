import test from 'node:test'
import assert from 'node:assert/strict'
import { comparisonQuery, metricResult, metricSource, METRICS } from '../src/comparison.js'
import { NAV_AREAS, areaForView } from '../src/navigation.js'

test('four navigation areas preserve every established analytical destination', () => {
  assert.equal(NAV_AREAS.length, 4)
  for (const view of ['overview','maps','drill','analysis','parliament','seats','time','signals','benford','logs','compare']) assert.ok(areaForView(view), view)
  assert.equal(areaForView('sql'), null)
})

test('rates use aggregate numerators and denominators; unknown is not zero', () => {
  assert.deepEqual(metricResult('abstention_rate', { numerator: 30, denominator: 100, records: 2 }), { value: .3, numerator: 30, denominator: 100 })
  assert.equal(metricResult('abstention_rate', { numerator: 0, denominator: 0, records: 1 }).value, null)
  assert.equal(metricResult('present', { numerator: null, denominator: null, records: 0 }).value, null)
})

test('official participation selects one geographical scope, not nested sums', () => {
  const election = { year: 2026, turn: 2, hasTurnout: true }
  const query = comparisonQuery('abstention_rate', election, 'turnout')
  assert.match(query, /scope = case/)
  assert.match(query, /sum\(installed\)/)
  assert.doesNotMatch(query, /sum\(electorate\)/)
  assert.match(query, /city is not distinct from nullif/)
})

test('metric sources are capabilities, and do not invent unavailable logs', () => {
  assert.equal(metricSource('events', { hasTimes: false }, new Set(['vtc'])), null)
  assert.equal(metricSource('events', { hasTimes: true }, new Set(['vtc'])), 'vtc')
  assert.equal(metricSource('abstention_rate', { hasTurnout: true }, new Set(['turnout','sgz'])), 'turnout')
  assert.equal(metricSource('abstention_rate', { hasSignals: true }, new Set(['sgz'])), 'sgz')
  assert.equal(metricSource('abstention_rate', {}, new Set()), null)
  assert.equal(new Set(METRICS.map((m) => m.id)).size, METRICS.length)
})

test('every metric query executes against the shared schema and respects its grain', async () => {
  const { PGlite } = await import('@electric-sql/pglite')
  const db = new PGlite()
  try {
    await db.exec(`
      create table turnout(election int,turn int,scope text,state text,city text,installed int,present int,absent int);
      create table sgz(election int,turn int,state text,city text,aptos int,comp int,v int,man int,nor int,flagged int,sections int);
      create table tot(election int,turn int,state text,city text,office int,nominal int,blank int,nul int);
      create view totx as select * from tot;
      create table vtc(election int,turn int,state text,city text,n int,tz int,b int[]);
      create table seats(election int,turn int,uf text,office int,bloc text,seats int);
      insert into turnout values(2026,2,'br','br',null,100,70,30),(2026,2,'uf','ac',null,100,70,30),(2026,2,'city','ac','CITY',100,70,30);
      insert into sgz values(2026,2,'ac','CITY',10,0,10,1,2,1,1),(2026,2,'ac','OTHER',90,70,70,7,14,2,9);
      insert into tot values(2026,2,'ac','CITY',1,60,5,5);
      insert into vtc values(2026,2,'ac','CITY',70,0,'{0,70}');
      insert into seats values(2026,2,'ac',1,'A',2),(2026,2,'ac',1,'B',3);
    `)
    const election = { year: 2026, turn: 2, hasTurnout: true, hasSignals: true, hasTimes: true, hasSeats: true, hasResidual: true }
    const available = new Set(['turnout','sgz','tot','vtc','seats'])
    for (const metric of METRICS) {
      const source = metricSource(metric.id, election, available)
      const { rows: [r] } = await db.query(comparisonQuery(metric.id, election, source), ['', '', 1])
      assert.ok(metricResult(metric.id, r).value != null, metric.id)
    }
    const { rows: [official] } = await db.query(comparisonQuery('abstention_rate', election, 'turnout'), ['', '', 1])
    assert.deepEqual(metricResult('abstention_rate', official), { value: .3, numerator: 30, denominator: 100 })
    const { rows: [detail] } = await db.query(comparisonQuery('abstention_rate', election, 'sgz'), ['', '', 1])
    assert.equal(metricResult('abstention_rate', detail).value, .3, 'weights are electorate counts, not mean section rates')
    const { rows: [city] } = await db.query(comparisonQuery('abstention_rate', election, 'turnout'), ['ac', 'CITY', 1])
    assert.equal(Number(city.records), 1)
  } finally { await db.close() }
})
