// npm test: the section-log packs the browser reads (src/logpack.js) against packs written by `logscan pack` (tools/logscan) from real urn logs:
// three sections of Roraima and zone 127 section 680 of São Paulo (test/fixtures/logpack). The voters per method must equal what `logscan` counts
// (expected.tsv). The packs are served over HTTP with and without Range, as a static host would. Needs no database and no network.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { parseClock, inWindow, findPack, loadSection, sectionKey, parseIndex, METHODS } from '../src/logpack.js'

const dir = 'test/fixtures/logpack'
const stem = '2026-logpack-rr-01'
const expected = readFileSync(`${dir}/expected.tsv`, 'utf8').trim().split('\n').map((l) => l.split('\t'))
const config = { assets: [[stem, 'rr-03000-0000-0000', 'sp-99999-9999-9999', 4, 19974, 376]] }
const clock = (h, m = 0, s = 0) => h * 3600 + m * 60 + s

const requests = []
const serve = (ranges) => createServer((req, res) => {
  const file = readFileSync(`${dir}${req.url}`)
  const [, from, to] = /bytes=(\d+)-(\d+)/.exec(req.headers.range ?? '') ?? []
  requests.push(req.headers.range ?? 'whole')
  if (ranges && from) res.writeHead(206).end(file.subarray(Number(from), Number(to) + 1))
  else res.writeHead(200).end(file)
}).listen(0)
const [withRange, withoutRange] = [serve(true), serve(false)]
const url = (server) => `http://127.0.0.1:${server.address().port}/`
after(() => [withRange, withoutRange].forEach((s) => s.close()))

test('sections are found by their key and the clock is read as typed', () => {
  assert.equal(sectionKey('sp', 70998, 127, 680), 'sp-70998-0127-0680')
  assert.deepEqual(findPack(config, sectionKey('sp', 70998, 127, 680)).map((a) => a[0]), [stem])
  assert.deepEqual(findPack(config, sectionKey('ac', 1, 1, 1)), [])
  assert.deepEqual(['10:40', '10h40', '1040', '9', '10h', '24:00', '10:60', 'x', ''].map(parseClock), [clock(10, 40), clock(10, 40), clock(10, 40), clock(9), clock(10), null, null, null, null])
})

test('every section counts the voters of each method as logscan does', async () => {
  for (const [uf, city, zone, section, votes, bio, man, nor] of expected) {
    const { urns, bytes } = await loadSection(config, url(withRange), { uf, city, zone, section })
    assert.equal(urns.length, 1)
    const by = (m) => urns[0].voters.filter((v) => METHODS[v.method] === m).length
    assert.deepEqual([urns[0].voters.length, by('fingerprint'), by('afterTry'), by('withoutTry')], [votes, bio, man, nor].map(Number), `${uf}-${city}-${zone}-${section}`)
    assert.ok(bytes > 0 && bytes < 10000)
  }
})

test('the example section: who voted around 10:40, as the urn recorded it', async () => {
  const { urns: [section] } = await loadSection(config, url(withRange), { uf: 'sp', city: '70998', zone: '0127', section: '0680' })
  const shown = inWindow(section, clock(10, 30), clock(10, 50))
  assert.deepEqual(shown.voters.slice(0, 2).map((v) => [v.enabled, v.done, v.tries, v.wrong, v.corrected]), [[clock(10, 31, 6), clock(10, 31, 36), 1, 2, false], [clock(10, 32, 14), clock(10, 33, 1), 1, 0, false]])
  assert.equal(shown.voters.find((v) => v.enabled === clock(10, 33, 36)).corrected, true)
  assert.equal(shown.voters.length, 14)
  assert.ok(shown.voters.every((v) => v.done >= clock(10, 30) && v.enabled <= clock(10, 50)))
  assert.equal(inWindow(section, null, null), section)
})

test('lines outside the voters\' cycles keep their time and text, and people\'s ids are never stored', async () => {
  const { urns: [section] } = await loadSection(config, url(withRange), { uf: 'sp', city: '70998', zone: '0127', section: '0680' })
  const on = section.events.find((e) => e.text.startsWith('Urna ligada em'))
  assert.deepEqual([on.secs, on.level, on.module, on.text], [clock(7, 25, 42), 'INFO', 'LOGD', 'Urna ligada em 04/10/2026 às 07:25:05'])
  assert.ok(section.events.some((e) => e.text === 'Mesário # habilitou o eleitor'))
  assert.ok(section.events.every((e) => !/\d{10}/.test(e.text)))
  assert.ok(section.otherDays > 0)
})

test('only the bytes of the section are requested; a host without Range still answers', async () => {
  requests.length = 0
  const key = { uf: 'rr', city: '03000', zone: '0004', section: '0012' }
  const a = await loadSection(config, url(withRange), key)
  assert.equal(requests.filter((r) => r.startsWith('bytes=')).length, 1)
  assert.ok(a.bytes < 8000)
  const b = await loadSection(config, url(withoutRange), key)
  assert.deepEqual(b.urns, a.urns)
  assert.equal(b.bytes, a.bytes)
})

test('a section that is not in the pack has no urns, and the index lists every urn of the pack', async () => {
  const absent = await loadSection(config, url(withRange), { uf: 'rr', city: '03000', zone: '0004', section: '0999' })
  assert.deepEqual([absent.urns, absent.bytes], [[], 0])
  const idx = await (await fetch(`${url(withRange)}${stem}.idx`)).arrayBuffer()
  const raw = new Uint8Array(await new Response(new Blob([idx]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer())
  assert.deepEqual(parseIndex(raw).records.map((r) => [r.zone, r.section]), [[4, 11], [4, 12], [4, 13], [127, 680]])
})
