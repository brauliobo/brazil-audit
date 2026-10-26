// Exercises every comparison metric against the built app's complete shipped tables.
import assert from 'node:assert/strict'
import { METRICS } from '../src/comparison.js'
import { ELECTION_LIST } from '../src/elections.js'
import { browser, baseUrl, sleep } from './lib/browser.mjs'
const { ab, evaluate } = browser('comparison-data')
try {
  ab('open', `${baseUrl()}/${ELECTION_LIST.at(-1).key}/compare`)
  for (const metric of METRICS) {
    ab('select', 'main select', metric.id)
    for (let i = 0; i < 400 && !evaluate(`JSON.stringify(document.querySelectorAll('main tbody tr').length === ${ELECTION_LIST.length} && ![...document.querySelectorAll('.panel__badge')].some((n) => n.innerText === '…') && !document.querySelector('.skeleton'))`); i++) await sleep(150)
    const result = evaluate(`JSON.stringify({ rows: [...document.querySelectorAll('main tbody tr')].map((r) => [...r.cells].map((c) => c.innerText)), errors: [...document.querySelectorAll('.notice--danger')].map((n) => n.innerText), count: document.querySelectorAll('header.site-header > nav > a').length })`)
    assert.equal(result.count, 4)
    assert.equal(result.rows.length, ELECTION_LIST.length, metric.id)
    assert.deepEqual(result.errors, [], metric.id)
    assert.ok(result.rows.some((r) => r[1] !== '–'), `${metric.id}: at least one source must be available`)
    if (metric.id === 'abstention_rate') assert.ok(result.rows.some((r) => r[0].includes('2026') && /19[,.]22/.test(r[1])), 'official second-round denominator')
    console.log(`ok ${metric.id}: ${result.rows.filter((r) => r[1] !== '–').length}/${result.rows.length} elections`)
  }
} finally { ab('close') }
